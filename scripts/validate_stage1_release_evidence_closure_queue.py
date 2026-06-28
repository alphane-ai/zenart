#!/usr/bin/env python3
"""Validate Stage 1 release evidence closure queue contract and preflight."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "release_evidence_closure_queue" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-evidence-closure-queue.preflight.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_release_evidence_closure_queue.py"
VALIDATOR = ROOT / "scripts" / "validate_stage1_release_evidence_closure_queue.py"
RELEASE_READINESS_CONTRACT = ROOT / "fixtures" / "stage1" / "release_readiness" / "local_contract.json"
RELEASE_READINESS_VALIDATOR = ROOT / "scripts" / "validate_stage1_release_readiness_contract.py"
R2_READINESS_GENERATOR = ROOT / "scripts" / "stage1_r2_bucket_readiness.py"
R2_READINESS_VALIDATOR = ROOT / "scripts" / "validate_stage1_r2_bucket_readiness.py"
ADMIN_PAGE = ROOT / "admin" / "app" / "release" / "page.tsx"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_TESTS = ROOT / "admin" / "tests" / "admin-data.test.mjs"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

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

EXPECTED_GATES = [
    "stage1_staging_runtime_preflight",
    "staging_quota_replay",
    "stage1_load",
    "object_retention_cleanup",
    "ci_pr_main_run",
    "ci_playwright_smoke",
    "ci_docker_image_build",
    "stage1_production_launch_preflight",
    "production_backup_rollback_split",
    "production_provider_claims",
    "production_paid_billing_lifecycle",
    "production_security_launch_checks",
    "production_legal_support_policy",
    "production_governance_release",
]

REQUIRED_ROW_FIELDS = {
    "priority",
    "lane",
    "row_status",
    "gate",
    "required_evidence",
    "validator",
    "generator",
    "current_blocker",
    "dnl_impact",
}


class ReleaseEvidenceClosureQueueContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ReleaseEvidenceClosureQueueContractError(message)


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
        raise ReleaseEvidenceClosureQueueContractError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain JSON object")
    return data


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


def validate_contract_fixture() -> dict[str, Any]:
    contract = load_json(CONTRACT)
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.release_evidence_closure_queue.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "release_evidence_closure_queue_contract", "contract kind mismatch")
    require({"AD-14", "VF-6", "VF-7", "VF-8", "OP-14"} <= set(contract.get("blueprint_items") or []), "contract blueprint_items incomplete")
    require(contract.get("release_gate_status") == "contract_ready_evidence_closure_queue_open", "contract release gate status mismatch")
    require(contract.get("canonical_preflight_path") == "ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json", "contract preflight path mismatch")
    source_aggregates = contract.get("source_aggregates")
    require(isinstance(source_aggregates, list) and len(source_aggregates) == 3, "contract must list staging, production, and R2 readiness aggregates")
    by_id = {item.get("id"): item for item in source_aggregates if isinstance(item, dict)}
    require(by_id.get("staging_runtime", {}).get("path") == "ops/evidence/staging/stage1-runtime.json", "staging aggregate path mismatch")
    require(by_id.get("production_launch", {}).get("path") == "ops/evidence/production/stage1-production-launch.json", "production aggregate path mismatch")
    require(by_id.get("r2_bucket_readiness", {}).get("path") == "ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json", "R2 readiness aggregate path mismatch")
    require(contract.get("required_queue_gates") == EXPECTED_GATES, "required_queue_gates must match Admin closure queue order")
    require(set(contract.get("required_queue_fields") or []) == REQUIRED_ROW_FIELDS, "required_queue_fields mismatch")
    policy = contract.get("preflight_policy")
    require(isinstance(policy, dict), "preflight_policy must be object")
    require(policy.get("generator_command") == "python3 scripts/generate_stage1_release_evidence_closure_queue.py", "preflight generator command mismatch")
    require(policy.get("validator_command") == "python3 scripts/validate_stage1_release_evidence_closure_queue.py --allow-preflight", "preflight validator command mismatch")
    require(policy.get("accepted_schema_version") == "stage1.release_evidence_closure_queue.preflight.v1", "preflight accepted schema mismatch")
    require(policy.get("accepted_kind") == "stage1_release_evidence_closure_queue_preflight", "preflight accepted kind mismatch")
    require(policy.get("accepted_status") == "blocked", "preflight accepted status mismatch")
    require(policy.get("canonical_pass_path") is False, "preflight canonical_pass_path must be false")
    require(policy.get("can_clear_stage1_staging_runtime_gate") is False, "preflight must not clear staging gate")
    require(policy.get("can_clear_stage1_production_launch_gate") is False, "preflight must not clear production gate")
    require(policy.get("can_close_do_not_launch") is False, "preflight must not close DNL")
    require(policy.get("requires_strict_ci_staging_production_evidence_for_launch") is True, "preflight must require strict launch evidence")
    require(policy.get("strict_validator_still_rejects_preflight") is True, "strict validator reject policy mismatch")
    preserved = set(policy.get("must_preserve_do_not_launch_conditions") or [])
    require({"stage1_staging_runtime_evidence_incomplete", "stage1_production_launch_evidence_incomplete"} <= preserved, "preflight must preserve Stage1 DNL conditions")
    safe_policy = contract.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    non_launch = contract.get("non_launch_status")
    require(isinstance(non_launch, dict), "non_launch_status must be object")
    require(non_launch.get("local_contract") == "pass", "local contract status mismatch")
    require(non_launch.get("queue_evidence") == "open", "queue evidence status mismatch")
    require(non_launch.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging")
    require(non_launch.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production")
    require(non_launch.get("can_close_do_not_launch") is False, "local contract must not close DNL")
    for ref in contract.get("required_files", []):
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")
    return contract


def validate_code_anchors() -> None:
    require_text(
        GENERATOR,
        (
            "stage1.release_evidence_closure_queue.preflight.v1",
            "stage1_release_evidence_closure_queue_preflight",
            "can_clear_stage1_staging_runtime_gate",
            "can_clear_stage1_production_launch_gate",
            "can_close_do_not_launch",
            "strict python3 scripts/validate_stage1_staging_runtime.py must still reject",
            "strict python3 scripts/validate_stage1_production_launch.py must still reject",
            "stage1_staging_runtime_preflight",
            "stage1_production_launch_preflight",
            "stage1-r2-bucket-readiness.preflight.json",
            "stage1-ci-exact.preflight.json",
            "stage1-azure-origin-readiness.json",
            "azure-run-command-ssh-repair-diagnosis.json",
            "parallel_operational_blockers",
            "azure_origin_run_command_required",
            "DEFAULT_NEXT_BLOCKERS_SUMMARY",
            "operator_action_packet_summary",
            "operator_action_packet_items",
            "row_status",
            "completion_percent",
            "r2_bucket_blocker",
            "R2 bucket access ready; object_retention_cleanup still needs canonical staging evidence",
            "ci_exact_blocker",
            "fetch_stage1_ci_artifacts.py",
            "production_paid_billing_lifecycle",
            "safe_projection_policy",
        ),
    )
    require_text(
        VALIDATOR,
        (
            "stage1.release_evidence_closure_queue.contract.v1",
            "stage1.release_evidence_closure_queue.preflight.v1",
            "validate_preflight_evidence",
            "--allow-preflight",
            "strict mode rejects closure queue preflight",
            "EXPECTED_GATES",
        ),
    )
    require_text(
        ADMIN_PAGE,
        (
            "Evidence Closure Queue",
            "Parallel Ops Blockers",
            "Stage1EvidenceClosureQueueRow",
            "Stage1EvidenceClosureQueueParallelBlocker",
            "closureQueue",
            "closureQueue.queue",
            "parallelOperationalBlockers",
            "parallelOperationalBlockerCount",
            "stage1-evidence-closure-queue.preflight.json",
            "data-release-evidence-closure-queue",
            "data-release-evidence-parallel-operational-blockers",
            "data-release-evidence-azure-origin-parallel-blocker",
            "azure_origin_run_command_required",
            "non_clearing_parallel_ops_only",
        ),
    )
    require_text(
        RELEASE_READINESS_CONTRACT,
        (
            "release_evidence_closure_queue",
            "stage1-evidence-closure-queue.preflight.json",
            "Stage1EvidenceClosureQueue",
            "Stage1EvidenceClosureQueueRow",
            "closureQueue",
            "generate_stage1_release_evidence_closure_queue.py",
            "validate_stage1_release_evidence_closure_queue.py --allow-preflight",
        ),
    )
    require_text(
        ADMIN_API,
        (
            "ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json",
            "Stage1EvidenceClosureQueue",
            "Stage1EvidenceClosureQueueParallelBlocker",
            "Stage1EvidenceClosureQueueOperatorActionPacketSummary",
            "Stage1EvidenceClosureQueueOperatorActionPacketItem",
            "Stage1EvidenceClosureQueueRow",
            "closureQueueEvidence",
            "mapStage1EvidenceClosureQueue",
            "missingStage1EvidenceClosureQueue",
            "mapStage1EvidenceClosureQueueParallelBlocker",
            "mapStage1EvidenceClosureQueueOperatorActionPacketSummary",
            "parallelOperationalBlockers",
            "parallelOperationalBlockerCount",
            "operatorActionPacketSummary",
            "operatorActionPacketItems",
            "mapStage1EvidenceClosureQueueRow",
            "closureQueueLane",
        ),
    )
    require_text(
        ADMIN_TYPES,
        (
            "Stage1EvidenceClosureQueue",
            "Stage1EvidenceClosureQueueParallelBlocker",
            "Stage1EvidenceClosureQueueOperatorActionPacketSummary",
            "Stage1EvidenceClosureQueueOperatorActionPacketItem",
            "Stage1EvidenceClosureQueueRow",
            "requiredEvidence",
            "currentBlocker",
            "dnlImpact",
            "openGates",
            "parallelOperationalBlockers",
            "parallelOperationalBlockerCount",
            "operatorActionPacketSummary",
            "operatorActionPacketItems",
            "closureQueue",
        ),
    )
    require_text(
        RELEASE_READINESS_VALIDATOR,
        (
            "validate_stage1_release_evidence_closure_queue.py",
            "stage1-evidence-closure-queue.preflight.json",
            "mapStage1EvidenceClosureQueue",
            "Stage1EvidenceClosureQueue",
        ),
    )
    require_text(
        ADMIN_TESTS,
        (
            "release_evidence_closure_queue",
            "stage1-evidence-closure-queue.preflight.json",
            "Stage1EvidenceClosureQueue",
            "Stage1EvidenceClosureQueueParallelBlocker",
            "Stage1EvidenceClosureQueueOperatorActionPacketSummary",
            "Stage1EvidenceClosureQueueOperatorActionPacketItem",
            "Stage1EvidenceClosureQueueRow",
            "parallel_operational_blockers",
            "operator_action_packet_summary",
            "parallelOperationalBlockers",
            "parallelOperationalBlockerCount",
            "operatorActionPacketSummary",
            "operatorActionPacketItems",
            "data-release-evidence-parallel-operational-blockers",
            "data-release-evidence-azure-origin-parallel-blocker",
            "data-release-evidence-operator-action-packet-summary",
            "data-release-evidence-operator-action-packet-count",
            "data-release-evidence-operator-action-packet-non-clearing",
            "Production / Azure Operator Action Packet",
            "azure_origin_run_command_required",
            "non_clearing_parallel_ops_only",
            "operator_action_packet_items",
            "closureQueue",
            "mapStage1EvidenceClosureQueue",
            "generate_stage1_release_evidence_closure_queue.py",
            "validate_stage1_release_evidence_closure_queue.py",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/generate_stage1_release_evidence_closure_queue.py",
            "test -x scripts/validate_stage1_release_evidence_closure_queue.py",
            "python3 scripts/generate_stage1_release_evidence_closure_queue.py --contract-only",
            "python3 scripts/validate_stage1_release_evidence_closure_queue.py --contract-only",
            "python3 scripts/validate_stage1_release_evidence_closure_queue.py --allow-preflight",
        ),
    )
    require_text(
        R2_READINESS_GENERATOR,
        (
            "probe_blocker_summary",
            "http_status=",
            "cf_ray",
            "code",
            "message",
        ),
    )
    require_text(
        R2_READINESS_VALIDATOR,
        (
            "detail.body_sha256",
            "stage1-r2-bucket-readiness.preflight.json",
        ),
    )


def validate_preflight_evidence(data: dict[str, Any]) -> None:
    assert_no_secret(data, "preflight")
    require(data.get("schema_version") == "stage1.release_evidence_closure_queue.preflight.v1", "preflight schema_version mismatch")
    require(data.get("kind") == "stage1_release_evidence_closure_queue_preflight", "preflight kind mismatch")
    require(data.get("environment") == "release", "preflight environment mismatch")
    require(data.get("status") == "blocked", "preflight status must be blocked")
    require(data.get("release_gate_decision") == "no_go", "preflight release gate decision must be no_go")
    require(data.get("canonical_pass_path") is False, "preflight canonical_pass_path must be false")
    require(data.get("can_clear_stage1_staging_runtime_gate") is False, "preflight cannot clear Stage 1 staging runtime")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "preflight cannot clear Stage 1 production launch")
    require(data.get("can_close_do_not_launch") is False, "preflight cannot close DNL")
    safe_policy = data.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "preflight safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_policy.get(field) is False, f"preflight.safe_projection_policy.{field} must be false")
        require(data.get(field) is False, f"preflight.{field} must be false")
    source = data.get("source_aggregates")
    require(isinstance(source, dict), "source_aggregates must be object")
    staging = source.get("staging_runtime")
    production = source.get("production_launch")
    r2 = source.get("r2_bucket_readiness")
    ci_preflight = source.get("ci_exact_preflight")
    require(isinstance(staging, dict), "source_aggregates.staging_runtime must be object")
    require(isinstance(production, dict), "source_aggregates.production_launch must be object")
    require(isinstance(r2, dict), "source_aggregates.r2_bucket_readiness must be object")
    require(isinstance(ci_preflight, dict), "source_aggregates.ci_exact_preflight must be object")
    require(isinstance(staging.get("path"), str) and staging.get("path"), "staging source path missing")
    require(isinstance(production.get("path"), str) and production.get("path"), "production source path missing")
    require(isinstance(r2.get("path"), str) and r2.get("path").endswith("stage1-r2-bucket-readiness.preflight.json"), "R2 source path missing")
    require(isinstance(ci_preflight.get("path"), str) and ci_preflight.get("path").endswith("stage1-ci-exact.preflight.json"), "CI preflight source path missing")
    require(staging.get("schema_version") == "stage1.staging_runtime.v1", "staging source schema mismatch")
    require(production.get("schema_version") == "stage1.production_launch.v1", "production source schema mismatch")
    require(r2.get("schema_version") in {"stage1.r2_bucket_readiness.preflight.v1", "missing"}, "R2 source schema mismatch")
    preserved = set(data.get("do_not_launch_conditions_preserved") or [])
    staging_dnl = set(staging.get("do_not_launch_conditions") or [])
    production_dnl = set(production.get("do_not_launch_conditions") or [])
    if "stage1_staging_runtime_evidence_incomplete" in staging_dnl:
        require("stage1_staging_runtime_evidence_incomplete" in preserved, "preflight must preserve staging DNL")
    if "stage1_production_launch_evidence_incomplete" in production_dnl:
        require("stage1_production_launch_evidence_incomplete" in preserved, "preflight must preserve production DNL")
    queue = data.get("queue")
    require(isinstance(queue, list), "queue must be list")
    require(len(queue) == len(EXPECTED_GATES), "queue length mismatch")
    for idx, row in enumerate(queue):
        require(isinstance(row, dict), f"queue[{idx}] must be object")
        require(REQUIRED_ROW_FIELDS <= set(row), f"queue[{idx}] missing required fields")
        require(row.get("gate") == EXPECTED_GATES[idx], f"queue[{idx}] gate order mismatch")
        require(row.get("priority") in {"P0", "P1", "P2"}, f"queue[{idx}] priority mismatch")
        require(row.get("lane") in {"staging", "ci", "production"}, f"queue[{idx}] lane mismatch")
        for field in REQUIRED_ROW_FIELDS:
            require(isinstance(row.get(field), str) and row.get(field).strip(), f"queue[{idx}].{field} must be non-empty string")
        require(row.get("row_status") in {"open", "passed"}, f"queue[{idx}] row_status mismatch")
        if row["gate"].endswith("_preflight"):
            require("--allow-preflight" in row["validator"], f"queue[{idx}] preflight validator must use --allow-preflight")
            require("must still reject" in row["generator"], f"queue[{idx}] must preserve strict reject language")
        else:
            require("--allow-preflight" not in row["validator"], f"queue[{idx}] canonical row validator must not use --allow-preflight")
        if row.get("lane") == "ci":
            require("fetch_stage1_ci_artifacts.py" in row.get("generator", ""), f"queue[{idx}] CI row must use artifact fetcher")
            blocker = row.get("current_blocker", "")
            require(
                "ci_exact_preflight" in blocker or "exact CI artifacts" in blocker,
                f"queue[{idx}] CI row must surface CI exact preflight or artifact SHA blocker",
            )
            if row.get("row_status") == "passed":
                require(
                    "strict-pass for current release SHA" in blocker and "canonical evidence" in blocker,
                    f"queue[{idx}] passed CI row must cite current-SHA canonical exact evidence",
                )
                require("no current DNL impact" in row.get("dnl_impact", ""), f"queue[{idx}] passed CI row must not preserve stale CI DNL impact")
            else:
                require(
                    "blocked_checks=" in blocker
                    or "missing or invalid" in blocker
                    or "ready - trigger" in blocker
                    or "fetch current GitHub Actions artifacts" in blocker,
                    f"queue[{idx}] CI row must include actionable CI detail",
                )
        if row.get("gate") == "object_retention_cleanup":
            blocker = row.get("current_blocker", "")
            r2_ready = r2.get("status") == "ready"
            if row.get("row_status") == "passed":
                require(
                    "object retention cleanup evidence passed" in blocker
                    or "canonical object retention cleanup evidence passed" in blocker,
                    "passed object retention row must surface verified canonical evidence",
                )
            elif r2_ready:
                require(
                    "R2 bucket access ready" in blocker
                    and "ops/evidence/staging/object-storage-retention-cleanup.json" in blocker,
                    "object retention row must surface canonical staging evidence blocker after R2 access is ready",
                )
            else:
                require("s3_" in blocker or "R2 bucket readiness" in blocker, "object retention row must surface R2 bucket readiness blocker")
                require("http_status=" in blocker or "missing or invalid" in blocker, "object retention row must include actionable R2 HTTP status when present")
    summary = data.get("queue_summary")
    require(isinstance(summary, dict), "queue_summary must be object")
    require(summary.get("total") == len(EXPECTED_GATES), "queue_summary total mismatch")
    open_rows = [row for row in queue if row.get("row_status") != "passed"]
    open_gates = [row["gate"] for row in open_rows]
    require(summary.get("open") == len(open_rows), "queue_summary open mismatch")
    require(summary.get("completed") == len(EXPECTED_GATES) - len(open_rows), "queue_summary completed mismatch")
    require(summary.get("open_gates") == open_gates, "queue_summary open_gates mismatch")
    require(isinstance(summary.get("parallel_operational_blockers"), int), "queue_summary.parallel_operational_blockers must be int")
    require(isinstance(summary.get("operator_action_packet_items"), int), "queue_summary.operator_action_packet_items must be int")
    require(isinstance(summary.get("completion_percent"), (int, float)), "queue_summary completion_percent must be numeric")
    by_lane = summary.get("by_lane")
    require(isinstance(by_lane, dict), "queue_summary.by_lane must be object")
    require(by_lane.get("staging") == sum(1 for row in open_rows if row["lane"] == "staging"), "staging lane count mismatch")
    require(by_lane.get("ci") == sum(1 for row in open_rows if row["lane"] == "ci"), "ci lane count mismatch")
    require(by_lane.get("production") == sum(1 for row in open_rows if row["lane"] == "production"), "production lane count mismatch")
    strict_required = set(data.get("strict_launch_evidence_required") or [])
    require("ops/evidence/ci/stage0-rev2-pr-main-run.json" in strict_required, "strict launch evidence must include CI pr-main")
    require("ops/evidence/staging/stage1-runtime.json" in strict_required, "strict launch evidence must include staging runtime")
    require("ops/evidence/production/stage1-production-launch.json" in strict_required, "strict launch evidence must include production launch")
    parallel = data.get("parallel_operational_blockers")
    require(isinstance(parallel, list), "parallel_operational_blockers must be list")
    require(summary.get("parallel_operational_blockers") == len(parallel), "parallel blocker summary mismatch")
    for idx, blocker in enumerate(parallel):
        require(isinstance(blocker, dict), f"parallel_operational_blockers[{idx}] must be object")
        for field in ("blocker_id", "lane", "status", "release_gate_impact", "current_blocker", "next_action", "operator_command"):
            require(isinstance(blocker.get(field), str) and blocker.get(field).strip(), f"parallel_operational_blockers[{idx}].{field} must be non-empty string")
        require(blocker.get("lane") == "staging_ops", f"parallel_operational_blockers[{idx}].lane must be staging_ops")
        require(blocker.get("status") == "blocked", f"parallel_operational_blockers[{idx}].status must be blocked")
        require(blocker.get("release_gate_impact") == "non_clearing_parallel_ops_only", f"parallel_operational_blockers[{idx}] must be non-clearing")
        require(blocker.get("can_clear_stage1_staging_runtime_gate") is False, f"parallel_operational_blockers[{idx}] cannot clear staging")
        require(blocker.get("can_clear_stage1_production_launch_gate") is False, f"parallel_operational_blockers[{idx}] cannot clear production")
        require(blocker.get("can_close_do_not_launch") is False, f"parallel_operational_blockers[{idx}] cannot close DNL")
        refs = blocker.get("source_refs")
        require(isinstance(refs, list) and refs, f"parallel_operational_blockers[{idx}].source_refs must be non-empty")
        joined_refs = " ".join(str(ref) for ref in refs)
        if blocker.get("blocker_id") == "azure_origin_run_command_required":
            require("stage1-azure-origin-readiness.json" in joined_refs, "Azure parallel blocker must cite origin readiness")
            require("azure-run-command-ssh-repair-diagnosis.json" in joined_refs, "Azure parallel blocker must cite Run Command diagnosis")
            require("ingest_azure_run_command_output.py" in blocker.get("operator_command", ""), "Azure parallel blocker must point to ingest command")
            require(
                "Run Command" in blocker.get("current_blocker", "") or "Run Command" in blocker.get("next_action", ""),
                "Azure parallel blocker must explain Run Command dependency",
            )
    action_summary = data.get("operator_action_packet_summary")
    require(isinstance(action_summary, dict), "operator_action_packet_summary must be object")
    require(action_summary.get("source_path") == "ops/evidence/non_clearing/stage1-next-blockers-summary.json", "operator action packet source path mismatch")
    require(action_summary.get("source_schema_version") == "stage1.next_blockers_summary.v1", "operator action packet source schema mismatch")
    require(action_summary.get("release_gate_decision") == "no_go", "operator action packet source decision must be no_go")
    require(action_summary.get("canonical_pass_path") is False, "operator action packet summary cannot be canonical pass")
    require(action_summary.get("can_clear_stage1_staging_runtime_gate") is False, "operator action packet summary cannot clear staging")
    require(action_summary.get("can_clear_stage1_production_launch_gate") is False, "operator action packet summary cannot clear production")
    require(action_summary.get("can_close_do_not_launch") is False, "operator action packet summary cannot close DNL")
    require(action_summary.get("source_gate_flags_all_false") is True, "operator action packet source gate flags must all be false")
    items = action_summary.get("items")
    require(isinstance(items, list), "operator_action_packet_summary.items must be list")
    require(action_summary.get("total") == len(items), "operator action packet total mismatch")
    require(summary.get("operator_action_packet_items") == len(items), "operator action packet queue summary mismatch")
    parallel_count = len(data.get("parallel_operational_blockers") or [])
    item_ids = [str(item.get("item_id")) for item in items if isinstance(item, dict)]
    required_production_item_ids = [
        "production_dns_https",
        "production_live_billing",
        "production_security_runtime",
        "production_governance_release",
    ]
    expected_item_ids = []
    if "production_source_probes_missing" in item_ids:
        expected_item_ids.append("production_source_probes_missing")
    expected_item_ids.extend(required_production_item_ids)
    if parallel_count:
        expected_item_ids.append("azure_run_command_output_missing")
    require(len(items) == len(expected_item_ids), "operator action packet must keep the compact blind handoff")
    require(item_ids == expected_item_ids, "operator action packet item order mismatch")
    require(action_summary.get("blocked") == len(items), "operator action packet blocked count mismatch")
    require(action_summary.get("requires_external_input") == len(items), "operator action packet external input count mismatch")
    owner_counts = action_summary.get("owner_counts")
    require(isinstance(owner_counts, dict), "operator action packet owner_counts must be object")
    require(owner_counts.get("operator_production_account") == 3, "operator production account owner count mismatch")
    require(owner_counts.get("operator_cloudflare_dns") == 1, "operator Cloudflare DNS owner count mismatch")
    if "production_source_probes_missing" in item_ids:
        require(owner_counts.get("agent_after_operator_input") == 1, "operator source-probe handoff owner count mismatch")
    else:
        require("agent_after_operator_input" not in owner_counts, "operator source-probe handoff owner count must be absent after DNS is top priority")
    expected_azure_owner_count = 1 if parallel_count else None
    if expected_azure_owner_count is None:
        require("operator_azure_portal" not in owner_counts, "operator Azure owner count must be absent after Azure origin pass")
    else:
        require(owner_counts.get("operator_azure_portal") == expected_azure_owner_count, "operator Azure owner count mismatch")
    gate_impact_counts = action_summary.get("gate_impact_counts")
    require(isinstance(gate_impact_counts, dict), "operator action packet gate_impact_counts must be object")
    production_shortlist_count = len(required_production_item_ids) + (1 if "production_source_probes_missing" in item_ids else 0)
    require(
        gate_impact_counts.get("non_clearing_operator_shortlist_only") == production_shortlist_count,
        "operator packet production non-clearing count mismatch",
    )
    if parallel_count:
        require(gate_impact_counts.get("non_clearing_parallel_ops_only") == 1, "operator packet Azure non-clearing count mismatch")
    else:
        require("non_clearing_parallel_ops_only" not in gate_impact_counts, "operator packet Azure non-clearing count must be absent after Azure origin pass")
    for idx, item in enumerate(items):
        require(isinstance(item, dict), f"operator_action_packet_summary.items[{idx}] must be object")
        for field in (
            "item_id",
            "owner",
            "status",
            "required_return_artifact",
            "agent_command_after_return",
            "validation_after_return",
            "evidence_ref",
            "gate_impact",
        ):
            require(isinstance(item.get(field), str) and item.get(field).strip(), f"operator_action_packet_summary.items[{idx}].{field} must be non-empty")
        require(item.get("requires_external_input") is True, f"operator_action_packet_summary.items[{idx}] must require external input")
        require(item.get("status") == "blocked", f"operator_action_packet_summary.items[{idx}] status must be blocked")
        require(item.get("can_clear_stage1_staging_runtime_gate") is False, f"operator_action_packet_summary.items[{idx}] cannot clear staging")
        require(item.get("can_clear_stage1_production_launch_gate") is False, f"operator_action_packet_summary.items[{idx}] cannot clear production")
        require(item.get("can_close_do_not_launch") is False, f"operator_action_packet_summary.items[{idx}] cannot close DNL")
        if item.get("item_id") == "production_dns_https":
            require("R2 S3 credentials" not in item.get("required_return_artifact", ""), "DNS return artifact must not ask for R2 credentials")
            require("Cloudflare DNS" in item.get("required_return_artifact", ""), "DNS return artifact must ask for DNS permission or proof")
        if item.get("item_id") == "azure_run_command_output_missing":
            require(item.get("gate_impact") == "non_clearing_parallel_ops_only", "Azure action packet row must be parallel-only")
            require("ingest_azure_run_command_output.py" in item.get("agent_command_after_return", ""), "Azure action packet row must point to ingest command")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Stage 1 release evidence closure queue")
    parser.add_argument("--contract-only", action="store_true", help="validate local contract and code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing closure queue preflight evidence")
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract_fixture()
        validate_code_anchors()
        if args.contract_only:
            print("stage1 release evidence closure queue contract validation passed")
            return 0
        data = load_json(args.evidence)
        if not args.allow_preflight:
            raise ReleaseEvidenceClosureQueueContractError("strict mode rejects closure queue preflight; use --allow-preflight for non-clearing diagnostics")
        validate_preflight_evidence(data)
    except ReleaseEvidenceClosureQueueContractError as exc:
        print(f"stage1 release evidence closure queue validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 release evidence closure queue validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
