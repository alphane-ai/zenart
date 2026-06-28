#!/usr/bin/env python3
"""Validate Stage 1 exact CI evidence.

Contract-only mode validates the OP-2/OP-3/OP-4 evidence contract. Strict mode
requires the three canonical CI JSON files, matching release SHA, passing status,
CI environment, gate-impact closure, and no blocked/local/dry-run/secret/raw
payload markers.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "ci_exact" / "local_contract.json"
DEFAULT_PR_MAIN = ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-pr-main-run.json"
DEFAULT_PLAYWRIGHT = ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-playwright-smoke.json"
DEFAULT_DOCKER = ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-docker-image-build.json"
DEFAULT_PREFLIGHT_EVIDENCE = ROOT / "ops" / "evidence" / "ci" / "stage1-ci-exact.preflight.json"
STAGE0_VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"
PRODUCTION_LAUNCH_CONTRACT = ROOT / "fixtures" / "stage1" / "production_launch" / "local_contract.json"
PRODUCTION_LAUNCH_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_launch.py"
PRODUCTION_LAUNCH_GENERATOR = ROOT / "scripts" / "generate_stage1_production_launch_evidence.py"
WORKFLOW = ROOT / ".github" / "workflows" / "stage0-rev2-ci.yml"
OPS_CI = ROOT / "ops" / "ci" / "stage0-rev2-ci.yml"
PLAYWRIGHT_SPEC = ROOT / "ops" / "ci" / "playwright-smoke.spec.ts"
PLAYWRIGHT_SCRIPT = ROOT / "scripts" / "playwright_smoke.sh"
PR_MAIN_EVIDENCE_WRITER = ROOT / "scripts" / "write_stage1_ci_pr_main_evidence.py"
PLAYWRIGHT_EVIDENCE_WRITER = ROOT / "scripts" / "write_stage1_ci_playwright_evidence.py"
DOCKER_SCRIPT = ROOT / "scripts" / "docker_build_smoke.sh"
DOCKER_EVIDENCE_WRITER = ROOT / "scripts" / "write_stage1_ci_docker_evidence.py"
CI_EXACT_PREFLIGHT_GENERATOR = ROOT / "scripts" / "generate_stage1_ci_exact_preflight.py"
CI_ARTIFACT_FETCHER = ROOT / "scripts" / "fetch_stage1_ci_artifacts.py"
BACKEND_DOCKERFILE = ROOT / "backend" / "Dockerfile"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
RUN_URL_RE = re.compile(r"^https://github\.com/.+/actions/runs/[0-9]+")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
PASS_STATUSES = {"pass", "passed"}
RELEASE_IMAGE_SET = {"backend", "web", "admin"}
FORBIDDEN_RELEASE_IMAGES = {"manager", "worker", "crawler", "migrate"}
SAFE_FALSE_FIELDS = {
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
}
SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "secret_key",
    "api_key",
    "provider_secret",
    "stripe_secret_key",
    "stripe_api_key",
    "webhook_secret",
    "stripe_webhook_secret",
    "billing_webhook_secret",
    "stripe-signature",
    "stripe_signature",
    "signature",
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
    "raw_payload",
    "raw_event",
    "raw_response",
    "raw_support_body",
    "download_url",
    "signed_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)
BLOCKED_MARKERS = {
    "blocked",
    "failed",
    "fail",
    "planned",
    "dry_run",
    "no_go",
    "no-go",
    "missing",
    "deferred",
    "pass_with_blockers_preserved",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
}
LOCAL_DEBUG_TRUE_FIELDS = {"local_devport_debug", "allow_local_devport_evidence"}
CANONICAL_PATH_FALSE_FIELDS = {"canonical_pass_path", "canonical_pass_paths"}
GATE_EMPTY_FIELDS = {
    "blocked_checks",
    "blocked_by_checks",
    "blockers",
    "do_not_launch_conditions",
    "active_do_not_launch_conditions",
    "remaining_blockers",
}
GATE_CLEAR_FIELDS = {
    "do_not_launch_condition_id",
    "preserved_do_not_launch_condition_id",
    "preserved_release_gate_check_id",
    "preserved_do_not_launch_condition_ids",
}


class Stage1CiExactEvidenceError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1CiExactEvidenceError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise Stage1CiExactEvidenceError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")
    return text


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in SECRET_FIELD_NAMES, f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def walk_values(value: Any) -> list[Any]:
    rows = [value]
    if isinstance(value, dict):
        for child in value.values():
            rows.extend(walk_values(child))
    elif isinstance(value, list):
        for child in value:
            rows.extend(walk_values(child))
    return rows


def normalized_string_values(value: Any) -> set[str]:
    return {child.strip().lower() for child in walk_values(value) if isinstance(child, str)}


def is_pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def truthy_gate_value(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"})


def falsey_gate_value(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.strip().lower() in {"false", "0", "no"})


def blocked_gate_signal_blockers(value: Any, path: str) -> list[str]:
    blockers: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            child_path = f"{path}.{key}"
            if normalized in LOCAL_DEBUG_TRUE_FIELDS and truthy_gate_value(child):
                blockers.append(f"{child_path} is true")
            if normalized in CANONICAL_PATH_FALSE_FIELDS and falsey_gate_value(child):
                blockers.append(f"{child_path} is false")
            if normalized.startswith("can_clear_") and falsey_gate_value(child):
                blockers.append(f"{child_path} is false")
            if normalized in GATE_EMPTY_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not empty")
            if normalized in GATE_CLEAR_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not cleared")
            blockers.extend(blocked_gate_signal_blockers(child, child_path))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            blockers.extend(blocked_gate_signal_blockers(child, f"{path}[{idx}]"))
    return blockers


def require_no_blocked_gate_signals(value: Any, path: str) -> None:
    blockers = blocked_gate_signal_blockers(value, path)
    require(not blockers, f"{path} contains blocked/debug-only gate signal(s): {blockers}")


def require_ref_list(value: Any, path: str) -> None:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be a non-empty string")


def required_evidence_by_artifact(contract: dict[str, Any]) -> dict[str, dict[str, Any]]:
    required = contract.get("required_evidence")
    require(isinstance(required, list) and len(required) == 3, "required_evidence must list three CI artifacts")
    by_id = {item.get("artifact_id"): item for item in required if isinstance(item, dict)}
    expected = {"pr_main_run", "playwright_smoke", "docker_image_build"}
    require(expected <= set(by_id), f"contract missing CI artifacts {sorted(expected - set(by_id))}")
    return by_id


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.ci_exact.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "ci_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("release_gate_status") == "contract_ready_exact_ci_evidence_open", "contract must keep CI exact evidence open")
    require(contract.get("required_environment") == "ci", "contract environment mismatch")
    by_id = required_evidence_by_artifact(contract)
    expected_paths = {
        "pr_main_run": "ops/evidence/ci/stage0-rev2-pr-main-run.json",
        "playwright_smoke": "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
        "docker_image_build": "ops/evidence/ci/stage0-rev2-docker-image-build.json",
    }
    expected_gate_ids = {
        "pr_main_run": "ci_gate_runtime_execution",
        "playwright_smoke": "ci_playwright_smoke",
        "docker_image_build": "ci_docker_image_build",
    }
    for artifact_id, item in by_id.items():
        require(item.get("path") == expected_paths[artifact_id], f"{artifact_id} path mismatch")
        require(item.get("release_gate_check_id") == expected_gate_ids[artifact_id], f"{artifact_id} release gate mismatch")
        require(isinstance(item.get("required_schema_version"), str) and item["required_schema_version"].startswith("stage1.ci_"), f"{artifact_id} schema mismatch")
        require(isinstance(item.get("required_kind"), str) and item["required_kind"].startswith("ci_"), f"{artifact_id} kind mismatch")
        proofs = item.get("required_proofs")
        require(isinstance(proofs, list) and len(proofs) >= 5, f"{artifact_id} required_proofs must be specific")
    safe_policy = contract.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    strict_policy = contract.get("strict_evidence_policy")
    require(isinstance(strict_policy, dict), "strict_evidence_policy must be object")
    require(strict_policy.get("environment") == "ci", "strict policy environment mismatch")
    require(strict_policy.get("status") == "pass", "strict policy status mismatch")
    require(strict_policy.get("canonical_pass_path_required") is True, "strict policy must require canonical pass paths")
    require(strict_policy.get("release_sha_must_match_all_files") is True, "strict policy must require matching release SHA")
    require(strict_policy.get("do_not_launch_conditions_must_be_empty") is True, "strict policy must require no active DNL")
    require(strict_policy.get("gate_impact_can_clear_required") is True, "strict policy must require gate impact closure")
    require(contract.get("preflight_evidence_path") == "ops/evidence/ci/stage1-ci-exact.preflight.json", "preflight evidence path mismatch")
    preflight = contract.get("preflight_policy")
    require(isinstance(preflight, dict), "preflight_policy must be object")
    require(preflight.get("generator_command") == "python3 scripts/generate_stage1_ci_exact_preflight.py", "preflight generator command mismatch")
    require(preflight.get("status_ready_does_not_clear_gate") is True, "preflight ready must not clear gate")
    require(preflight.get("canonical_artifacts_written") is False, "preflight must not write canonical artifacts")
    require(preflight.get("requires_github_actions_for_strict_evidence") is True, "preflight must require GitHub Actions strict evidence")
    require(preflight.get("can_clear_ci_gate") is False, "preflight must not clear CI gate")
    require(preflight.get("can_clear_stage1_production_launch_gate") is False, "preflight must not clear production launch")
    artifact_fetch = contract.get("artifact_fetch_policy")
    require(isinstance(artifact_fetch, dict), "artifact_fetch_policy must be object")
    require(artifact_fetch.get("fetch_command") == "python3 scripts/fetch_stage1_ci_artifacts.py", "artifact fetch command mismatch")
    require(
        artifact_fetch.get("fetch_latest_successful_command") == "python3 scripts/fetch_stage1_ci_artifacts.py --latest-successful --repository <owner/repo>",
        "artifact latest successful fetch command mismatch",
    )
    require(artifact_fetch.get("strict_validator") == "python3 scripts/validate_stage1_ci_exact_evidence.py", "artifact fetch strict validator mismatch")
    require(artifact_fetch.get("canonical_artifacts_written_only_after_strict_validation") is True, "artifact fetch must require strict validation before publish")
    require(artifact_fetch.get("raw_artifact_zip_persisted") is False, "artifact fetch must not persist raw zips")
    require(artifact_fetch.get("github_token_persisted") is False, "artifact fetch must not persist GitHub token")
    require(artifact_fetch.get("can_clear_ci_gate_directly") is False, "artifact fetch must not directly clear CI gate")


def validate_code_anchors() -> None:
    require_text(BLUEPRINT, ("OP-2", "OP-3", "OP-4", "stage0-rev2-pr-main-run.json", "stage0-rev2-playwright-smoke.json", "stage0-rev2-docker-image-build.json"))
    require_text(GAP_INVENTORY, ("OP-2", "OP-4", "Exact CI evidence files remain open"))
    require_text(STAGE0_VALIDATOR, ("CI_PR_MAIN_RUN_EVIDENCE", "CI_PLAYWRIGHT_SMOKE_EVIDENCE", "CI_DOCKER_IMAGE_BUILD_EVIDENCE", "ci_gate_runtime_execution", "ci_playwright_smoke", "ci_docker_image_build"))
    require_text(PRODUCTION_LAUNCH_CONTRACT, ("required_ci_evidence", "stage0-rev2-pr-main-run.json", "stage0-rev2-playwright-smoke.json", "stage0-rev2-docker-image-build.json"))
    require_text(PRODUCTION_LAUNCH_VALIDATOR, ("required_ci_evidence", "ops/evidence/ci/", "strict_staging_validator_must_pass"))
    require_text(PRODUCTION_LAUNCH_GENERATOR, ("def ci_status", "missing CI evidence", "environment is not ci"))
    pre_launch_contract_anchors = (
        "validate_stage1_gap_inventory.py",
        "validate_stage1_env_example_contract.py",
        "validate_stage1_local_devport_registry.py --contract-only",
        "validate_stage1_release_image_boundary.py",
        "validate_stage1_prompt_composer_contract.py",
        "validate_stage1_result_placement_contract.py",
        "validate_stage1_safety_export_state_contract.py",
        "validate_stage1_rendered_export_asset_contract.py",
        "validate_stage1_export_object_access_contract.py",
        "validate_stage1_release_evidence_closure_queue.py --contract-only",
        "validate_stage1_external_resource_readiness.py --contract-only",
        "validate_stage1_r2_bucket_readiness.py --contract-only",
        "validate_stage1_audit_search_export_contract.py",
        "validate_stage1_operations_incident_runbook_contract.py",
        "validate_stage1_support_admin_deletion_governance_contract.py",
        "validate_stage1_production_dns_repair_packet.py --contract-only",
        "validate_stage1_production_blocker_checklist.py --contract-only",
        "validate_stage1_next_blockers_summary.py --contract-only",
    )
    require_text(WORKFLOW, ("pull_request", "push", "validate_stage1_production_launch.py --contract-only", "playwright-smoke", "docker-images"))
    require_text(WORKFLOW, pre_launch_contract_anchors)
    require_text(
        WORKFLOW,
        (
            "ci-exact-evidence",
            "CI exact evidence aggregate validation",
            "actions/download-artifact@v4",
            "Validate exact CI evidence artifacts together",
            "python3 scripts/validate_stage1_ci_exact_evidence.py",
            "python3 scripts/generate_stage1_ci_release_gate_evidence.py",
            "python3 scripts/generate_stage1_release_candidate_metadata.py",
            "python3 scripts/generate_stage1_release_metadata_preflight.py",
            "stage1-release-metadata-preflight.json",
            "python3 scripts/render_no_go_release_notes.py --write",
            "python3 scripts/validate_stage0_rev2.py",
            "stage1-ci-exact-evidence-aggregate",
        ),
    )
    require_text(WORKFLOW, ("write_stage1_ci_pr_main_evidence.py", "stage0-rev2-pr-main-run.json"))
    require_text(WORKFLOW, ("scripts/docker_build_smoke.sh", "write_stage1_ci_docker_evidence.py", "stage0-rev2-docker-image-build.json", "DOCKER_REPORT"))
    require_text(WORKFLOW, ("write_stage1_ci_playwright_evidence.py", "stage0-rev2-playwright-smoke.json", "validate_stage1_ci_exact_evidence.py", "PLAYWRIGHT_REPORT"))
    require_text(WORKFLOW, ("write_stage1_ci_docker_evidence.py", "stage0-rev2-docker-image-build.json", "DOCKER_REPORT", "scripts/docker_build_smoke.sh"))
    require_text(OPS_CI, ("playwright-smoke", "docker-images", "scripts/docker_build_smoke.sh"))
    require_text(OPS_CI, pre_launch_contract_anchors)
    require_text(
        OPS_CI,
        (
            "ci-exact-evidence",
            "CI exact evidence aggregate validation",
            "actions/download-artifact@v4",
            "Validate exact CI evidence artifacts together",
            "python3 scripts/validate_stage1_ci_exact_evidence.py",
            "python3 scripts/generate_stage1_ci_release_gate_evidence.py",
            "python3 scripts/generate_stage1_release_candidate_metadata.py",
            "python3 scripts/generate_stage1_release_metadata_preflight.py",
            "stage1-release-metadata-preflight.json",
            "python3 scripts/render_no_go_release_notes.py --write",
            "python3 scripts/validate_stage0_rev2.py",
            "stage1-ci-exact-evidence-aggregate",
        ),
    )
    require_text(OPS_CI, ("write_stage1_ci_pr_main_evidence.py", "stage0-rev2-pr-main-run.json"))
    require_text(OPS_CI, ("write_stage1_ci_docker_evidence.py", "stage0-rev2-docker-image-build.json", "DOCKER_REPORT"))
    require_text(
        PR_MAIN_EVIDENCE_WRITER,
        (
            "stage1.ci_pr_main_run.v1",
            "ops/evidence/ci/stage0-rev2-pr-main-run.json",
            "GITHUB_SHA",
            "GITHUB_RUN_ID",
            "GITHUB_REPOSITORY",
            "canonical_pass_path",
            "canonical-pass-path",
            "ci_gate_runtime_execution",
            "trigger must target main",
        ),
    )
    require_text(
        PLAYWRIGHT_SPEC,
        (
            "web workspace shell renders",
            "admin operations shell renders",
            "billing smoke validates quota, invoices, team seats, and checkout guards",
            "workspace smoke validates core workspace shell",
            "Billing and Quota",
            "Launch Direction Board",
        ),
    )
    require_text(
        PLAYWRIGHT_SCRIPT,
        (
            "playwright-smoke",
            "ops/ci/playwright-smoke.spec.ts",
            '"coverage"',
            '"safe_projection"',
            "$SPEC_PATH#billing smoke validates quota, invoices, team seats, and checkout guards",
            "$SPEC_PATH#workspace smoke validates core workspace shell",
        ),
    )
    require_text(
        PLAYWRIGHT_EVIDENCE_WRITER,
        (
            "stage1.ci_playwright_smoke.v1",
            "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
            "GITHUB_SHA",
            "GITHUB_RUN_ID",
            "GITHUB_REPOSITORY",
            "canonical_pass_path",
            "safe_projection",
        ),
    )
    require_text(DOCKER_SCRIPT, ("docker build", "backend", "web", "admin", "not a standalone release image"))
    require_text(
        DOCKER_EVIDENCE_WRITER,
        (
            "stage1.ci_docker_image_build.v1",
            "ops/evidence/ci/stage0-rev2-docker-image-build.json",
            "GITHUB_SHA",
            "GITHUB_RUN_ID",
            "GITHUB_REPOSITORY",
            "canonical_pass_path",
            "sha256:",
        ),
    )
    require_text(BACKEND_DOCKERFILE, ('ENTRYPOINT ["/app/server"]', "go build -o /out/worker ./cmd/worker"))
    require_text(
        REPO_VALIDATE,
        (
            "validate_stage1_ci_exact_evidence.py --contract-only",
            "generate_stage1_ci_exact_preflight.py --contract-only",
            "fetch_stage1_ci_artifacts.py --contract-only",
            "validate_stage1_ci_exact_evidence.py --allow-preflight",
            "write_stage1_ci_pr_main_evidence.py",
            "generate_stage1_ci_release_gate_evidence.py",
            "stage1 CI exact evidence strict fixture",
            "run_node_project_checks admin",
        ),
    )
    require_text(
        CI_ARTIFACT_FETCHER,
        (
            "stage1.ci_artifact_fetch.preflight.v1",
            "stage0-rev2-pr-main-run",
            "stage0-rev2-playwright-smoke",
            "stage0-rev2-docker-image-build",
            "stage1-ci-exact-evidence-aggregate",
            "--latest-successful",
            "latest_successful",
            "install .github/workflows/",
            "gh_cli",
            "validate_stage1_ci_exact_evidence.py",
            "canonical_artifacts_written",
            "raw_artifact_zip_persisted",
            "can_clear_ci_gate",
            "can_clear_stage1_production_launch_gate",
        ),
    )
    require_text(
        CI_EXACT_PREFLIGHT_GENERATOR,
        (
            "stage1.ci_exact.preflight.v1",
            "ops/evidence/ci/stage1-ci-exact.preflight.json",
            "canonical_pass_path",
            "can_clear_ci_gate",
            "can_clear_stage1_production_launch_gate",
            "canonical_evidence_ready",
            "git_worktree_clean",
        ),
    )


def validate_preflight(data: dict[str, Any]) -> None:
    assert_no_secret(data, "ci_exact_preflight")
    require(data.get("schema_version") == "stage1.ci_exact.preflight.v1", "preflight schema_version mismatch")
    require(data.get("environment") == "ci", "preflight environment must be ci")
    require(data.get("kind") == "ci_exact_evidence_preflight", "preflight kind mismatch")
    require(data.get("status") in {"ready", "blocked"}, "preflight status must be ready or blocked")
    require(data.get("release_gate_check_id") == "ci_exact_evidence", "preflight release gate check mismatch")
    require(data.get("preflight_report") == "ops/evidence/ci/stage1-ci-exact.preflight.json", "preflight report path mismatch")
    require(data.get("canonical_evidence_ready") is False, "preflight cannot mark canonical evidence ready")
    require(data.get("canonical_pass_path") is False, "preflight cannot use canonical pass path")
    require(data.get("can_clear_ci_gate") is False, "preflight cannot clear CI gate")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "preflight cannot clear production launch gate")
    require(data.get("can_close_do_not_launch") is False, "preflight cannot close DNL")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"preflight.{field} must be false")
    safe_policy = data.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "preflight safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_policy.get(field) is False, f"preflight.safe_projection_policy.{field} must be false")
    canonical_artifacts = data.get("canonical_artifacts")
    require(isinstance(canonical_artifacts, dict), "preflight canonical_artifacts must be object")
    expected_artifacts = {
        "pr_main_run": "ops/evidence/ci/stage0-rev2-pr-main-run.json",
        "playwright_smoke": "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
        "docker_image_build": "ops/evidence/ci/stage0-rev2-docker-image-build.json",
    }
    require(canonical_artifacts == expected_artifacts, "preflight canonical_artifacts mismatch")
    checks = data.get("checks")
    require(isinstance(checks, dict), "preflight checks must be object")
    required_checks = {
        "release_sha_full_length",
        "github_run_id_present",
        "github_repository_present",
        "github_run_url_actions",
        "trigger_targets_main",
        "git_worktree_clean",
        "installed_workflow_ready",
        "ops_ci_shadow_ready",
        "writer_scripts_ready",
        "smoke_sources_ready",
    }
    require(required_checks <= set(checks), f"preflight checks missing {sorted(required_checks - set(checks))}")
    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list), "preflight blocked_checks must be a list")
    expected_blockers = sorted(key for key in required_checks if checks.get(key) is not True)
    require(sorted(blocked_checks) == expected_blockers, f"preflight blocked_checks mismatch: {blocked_checks} vs {expected_blockers}")
    expected_status = "ready" if not expected_blockers else "blocked"
    require(data.get("status") == expected_status, f"preflight status must be {expected_status}")
    summary = data.get("workflow_run_summary")
    require(isinstance(summary, dict), "preflight workflow_run_summary must be object")
    release_sha = summary.get("release_sha")
    if checks.get("release_sha_full_length") is True:
        require(isinstance(release_sha, str) and RELEASE_SHA_RE.fullmatch(release_sha), "ready preflight release_sha must be full SHA")
    repository = summary.get("repository")
    if checks.get("github_repository_present") is True:
        require(isinstance(repository, str) and REPOSITORY_RE.fullmatch(repository), "ready preflight repository must be owner/name")
    run_url = summary.get("run_url")
    if checks.get("github_run_url_actions") is True:
        require(isinstance(run_url, str) and RUN_URL_RE.match(run_url), "ready preflight run_url must be GitHub Actions URL")
    anchors = data.get("anchors")
    require(isinstance(anchors, dict), "preflight anchors must be object")
    for key in ("workflow", "ops_ci", "playwright_spec", "pr_main_writer", "playwright_writer", "docker_writer", "docker_smoke", "playwright_smoke"):
        item = anchors.get(key)
        require(isinstance(item, dict), f"preflight anchors.{key} must be object")
        require(isinstance(item.get("path"), str) and item["path"], f"preflight anchors.{key}.path required")
        require(isinstance(item.get("ready"), bool), f"preflight anchors.{key}.ready must be boolean")
    next_contract = data.get("next_command_contract")
    require(isinstance(next_contract, dict), "preflight next_command_contract must be object")
    require(next_contract.get("requires_github_actions") is True, "preflight must require GitHub Actions for strict evidence")
    require(next_contract.get("strict_validator") == "python3 scripts/validate_stage1_ci_exact_evidence.py", "preflight strict validator mismatch")


def validate_base_evidence(data: dict[str, Any], *, artifact_id: str, schema_version: str, kind: str, release_gate_check_id: str) -> str:
    assert_no_secret(data, artifact_id)
    require_no_blocked_gate_signals(data, artifact_id)
    require(data.get("schema_version") == schema_version, f"{artifact_id} schema_version mismatch")
    require(data.get("environment") == "ci", f"{artifact_id} environment must be ci")
    require(data.get("kind") == kind, f"{artifact_id} kind mismatch")
    require(is_pass_status(data.get("status")), f"{artifact_id} status must pass")
    require(data.get("release_gate_check_id") == release_gate_check_id, f"{artifact_id} release gate check mismatch")
    release_sha = data.get("release_sha")
    require(isinstance(release_sha, str) and RELEASE_SHA_RE.fullmatch(release_sha), f"{artifact_id} release_sha must be full lowercase SHA")
    require(data.get("canonical_pass_path") is True, f"{artifact_id} canonical_pass_path must be true")
    require(data.get("dry_run") is False, f"{artifact_id} dry_run must be false")
    require(data.get("local_devport_debug") is False, f"{artifact_id} local_devport_debug must be false")
    markers = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
    require(not markers, f"{artifact_id} contains blocked marker(s): {markers}")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{artifact_id}.{field} must be false")
    workflow_run = data.get("workflow_run")
    require(isinstance(workflow_run, dict), f"{artifact_id}.workflow_run must be object")
    require(isinstance(workflow_run.get("run_id"), (int, str)) and str(workflow_run.get("run_id")).strip(), f"{artifact_id}.workflow_run.run_id is required")
    run_url = workflow_run.get("run_url")
    require(isinstance(run_url, str) and RUN_URL_RE.match(run_url), f"{artifact_id}.workflow_run.run_url must be GitHub Actions run URL")
    require(workflow_run.get("workflow_file") == ".github/workflows/stage0-rev2-ci.yml", f"{artifact_id}.workflow_run.workflow_file mismatch")
    require(workflow_run.get("conclusion") in {"success", "passed", "pass"}, f"{artifact_id}.workflow_run.conclusion must be success")
    refs = data.get("evidence_refs")
    require_ref_list(refs, f"{artifact_id}.evidence_refs")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), f"{artifact_id}.gate_impact must be object")
    require(gate.get("release_gate_check_id") == release_gate_check_id, f"{artifact_id}.gate_impact release gate mismatch")
    require(gate.get("can_clear_ci_gate_check") is True, f"{artifact_id}.gate_impact.can_clear_ci_gate_check must be true")
    return release_sha


def validate_pr_main(data: dict[str, Any]) -> str:
    release_sha = validate_base_evidence(
        data,
        artifact_id="pr_main_run",
        schema_version="stage1.ci_pr_main_run.v1",
        kind="ci_pr_main_run",
        release_gate_check_id="ci_gate_runtime_execution",
    )
    trigger = data.get("trigger")
    require(isinstance(trigger, dict), "pr_main_run.trigger must be object")
    require(trigger.get("event_name") in {"pull_request", "push", "workflow_dispatch"}, "pr_main_run trigger must be PR/main workflow")
    require(trigger.get("base_ref") == "main" or trigger.get("ref") == "refs/heads/main", "pr_main_run must target main")
    validations = data.get("validations")
    require(isinstance(validations, dict), "pr_main_run.validations must be object")
    for key in ("stage0_rev2", "stage1_prelaunch_contracts", "backend_go_tests", "web_checks", "admin_checks"):
        section = validations.get(key)
        require(isinstance(section, dict) and is_pass_status(section.get("status")), f"pr_main_run.validations.{key}.status must pass")
        require_ref_list(section.get("evidence_refs"), f"pr_main_run.validations.{key}.evidence_refs")
    return release_sha


def validate_playwright(data: dict[str, Any]) -> str:
    release_sha = validate_base_evidence(
        data,
        artifact_id="playwright_smoke",
        schema_version="stage1.ci_playwright_smoke.v1",
        kind="ci_playwright_smoke",
        release_gate_check_id="ci_playwright_smoke",
    )
    coverage = data.get("coverage")
    require(isinstance(coverage, dict), "playwright_smoke.coverage must be object")
    for key in ("user_web", "admin_web", "billing", "workspace"):
        section = coverage.get(key)
        require(isinstance(section, dict) and is_pass_status(section.get("status")), f"playwright_smoke.coverage.{key}.status must pass")
        require_ref_list(section.get("evidence_refs"), f"playwright_smoke.coverage.{key}.evidence_refs")
    return release_sha


def validate_docker(data: dict[str, Any]) -> str:
    release_sha = validate_base_evidence(
        data,
        artifact_id="docker_image_build",
        schema_version="stage1.ci_docker_image_build.v1",
        kind="ci_docker_image_build",
        release_gate_check_id="ci_docker_image_build",
    )
    images = data.get("images")
    require(isinstance(images, dict), "docker_image_build.images must be object")
    image_keys = set(images)
    require(image_keys == RELEASE_IMAGE_SET, f"docker_image_build.images must be exactly {sorted(RELEASE_IMAGE_SET)}, got {sorted(image_keys)}")
    image_set = data.get("image_set")
    require(isinstance(image_set, list), "docker_image_build.image_set must be list")
    require(set(image_set) == RELEASE_IMAGE_SET, f"docker_image_build.image_set must be exactly {sorted(RELEASE_IMAGE_SET)}")
    forbidden = sorted((image_keys | set(image_set)) & FORBIDDEN_RELEASE_IMAGES)
    require(not forbidden, f"docker_image_build must not include non-release images: {forbidden}")
    backend_runtime_targets = images.get("backend", {}).get("runtime_targets")
    if backend_runtime_targets is not None:
        require(
            isinstance(backend_runtime_targets, list) and "runtime-worker" in backend_runtime_targets,
            "backend runtime_targets must carry runtime-worker when reported",
        )
    for key in ("web", "admin", "backend"):
        image = images.get(key)
        require(isinstance(image, dict), f"docker_image_build.images.{key} must be object")
        require(is_pass_status(image.get("status")), f"docker_image_build.images.{key}.status must pass")
        digest = image.get("digest")
        require(isinstance(digest, str) and digest.startswith("sha256:") and len(digest) >= 71, f"docker_image_build.images.{key}.digest must be immutable sha256 digest")
        require_ref_list(image.get("evidence_refs"), f"docker_image_build.images.{key}.evidence_refs")
    return release_sha


def validate_all(pr_main_path: Path, playwright_path: Path, docker_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    release_shas = {
        validate_pr_main(load_json(pr_main_path)),
        validate_playwright(load_json(playwright_path)),
        validate_docker(load_json(docker_path)),
    }
    require(len(release_shas) == 1, f"CI release_sha values must match, got {sorted(release_shas)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Stage 1 exact CI evidence")
    parser.add_argument("--contract-only", action="store_true", help="validate local contract and code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing CI exact preflight evidence")
    parser.add_argument("--preflight", type=Path, default=DEFAULT_PREFLIGHT_EVIDENCE)
    parser.add_argument("--pr-main", type=Path, default=DEFAULT_PR_MAIN)
    parser.add_argument("--playwright", type=Path, default=DEFAULT_PLAYWRIGHT)
    parser.add_argument("--docker", type=Path, default=DEFAULT_DOCKER)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract_fixture(load_json(CONTRACT))
        validate_code_anchors()
        if args.contract_only:
            print("stage1 CI exact evidence contract passed")
            return 0
        if args.allow_preflight:
            validate_preflight(load_json(args.preflight))
            print("stage1 CI exact preflight evidence passed")
            return 0
        validate_all(args.pr_main, args.playwright, args.docker)
    except Stage1CiExactEvidenceError as exc:
        print(f"stage1 CI exact evidence validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 CI exact evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
