#!/usr/bin/env python3
"""Validate the short non-clearing Stage 1 production action matrix."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MATRIX = ROOT / "ops" / "evidence" / "non_clearing" / "production-action-matrix.json"
DEFAULT_MARKDOWN = ROOT / "ops" / "evidence" / "non_clearing" / "production-action-matrix.md"
DEFAULT_MISSING_INPUT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_production_action_matrix.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

LANE_ORDER = [
    "production_dns_https",
    "production_live_billing",
    "production_security_runtime",
    "production_governance_release",
]
DNS_PLAN_PRIVATE_ENV_COMMAND = (
    "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> "
    "--output ops/evidence/non_clearing/production-dns-cutover-plan.json"
)
DNS_APPLY_PRIVATE_ENV_COMMAND = (
    "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> "
    "--apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json"
)
DNS_PLAN_LEGACY_COMMAND = "python3 scripts/stage1_production_dns_cutover_plan.py --output ops/evidence/non_clearing/production-dns-cutover-plan.json"
DNS_APPLY_LEGACY_COMMAND = "python3 scripts/stage1_production_dns_cutover_plan.py --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json"
SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
)
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
    "database_url",
    "postgres_url",
    "download_url",
    "signed_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"X-Amz-Signature|GoogleAccessId)"
)


class ProductionActionMatrixValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionActionMatrixValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ProductionActionMatrixValidationError(f"missing {display_path(path)}") from exc


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise ProductionActionMatrixValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
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


def require_string(value: Any, path: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be non-empty string")
    return value.strip()


def require_bool(value: Any, path: str) -> bool:
    require(isinstance(value, bool), f"{path} must be bool")
    return value


def require_int(value: Any, path: str) -> int:
    require(isinstance(value, int), f"{path} must be int")
    require(value >= 0, f"{path} must be non-negative")
    return value


def require_number(value: Any, path: str) -> float:
    require(isinstance(value, (int, float)), f"{path} must be number")
    require(0 <= float(value) <= 100, f"{path} out of range")
    return float(value)


def require_list(value: Any, path: str, *, min_len: int = 0) -> list[Any]:
    require(isinstance(value, list), f"{path} must be list")
    require(len(value) >= min_len, f"{path} must contain at least {min_len} items")
    return value


def validate_code_anchors() -> None:
    generator = read_text(GENERATOR)
    for snippet in (
        "stage1.production_action_matrix.v1",
        "production-action-matrix.json",
        "production-action-matrix.md",
        "production_live_billing",
        "not_current_blockers",
        "worker/crawler/migrate are backend runtime entrypoints",
    ):
        require(snippet in generator, f"{display_path(GENERATOR)} missing {snippet!r}")
    repo_validate = read_text(REPO_VALIDATE)
    for snippet in (
        "generate_stage1_production_action_matrix.py --contract-only",
        "validate_stage1_production_action_matrix.py --contract-only",
        "production-action-matrix.json",
    ):
        require(snippet in repo_validate, f"{display_path(REPO_VALIDATE)} missing {snippet!r}")


def validate_matrix(data: dict[str, Any], markdown: str, missing: dict[str, Any], runbook: dict[str, Any]) -> None:
    assert_no_secret(data, "production_action_matrix")
    assert_no_secret(markdown, "production_action_matrix_markdown")
    require(data.get("schema_version") == "stage1.production_action_matrix.v1", "schema_version mismatch")
    require(data.get("kind") == "stage1_production_action_matrix", "kind mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("status") in {"blocked", "ready"}, "status mismatch")
    require(data.get("release_gate_decision") == "no_go", "matrix must remain no_go")
    require(data.get("non_clearing_action_matrix") is True, "matrix must be non-clearing")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "matrix cannot clear launch gate")
    require(data.get("can_close_do_not_launch") is False, "matrix cannot close do-not-launch")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    summary = data.get("summary")
    require(isinstance(summary, dict), "summary must be object")
    missing_summary = missing.get("summary")
    runbook_summary = runbook.get("summary")
    require(isinstance(missing_summary, dict), "missing.summary must be object")
    require(isinstance(runbook_summary, dict), "runbook.summary must be object")
    require(summary.get("production_inputs_configured") == missing_summary.get("required_configured"), "configured count mismatch")
    require(summary.get("production_inputs_total") == missing_summary.get("required_total"), "total count mismatch")
    require(summary.get("production_inputs_completion_percent") == missing_summary.get("required_completion_percent"), "input percent mismatch")
    require(summary.get("source_probes_ready") == runbook_summary.get("ready_to_execute_count"), "source ready count mismatch")
    require(summary.get("source_probes_total") == runbook_summary.get("runbook_step_count"), "source total count mismatch")
    require(summary.get("source_probes_blocked") == runbook_summary.get("blocked_step_count"), "source blocked count mismatch")

    lanes = require_list(data.get("lanes"), "lanes", min_len=4)
    require([lane.get("lane_id") for lane in lanes] == LANE_ORDER, "lane order mismatch")
    blocker_sum = 0
    for idx, lane in enumerate(lanes):
        require(isinstance(lane, dict), f"lanes[{idx}] must be object")
        require_int(lane.get("order"), f"lanes[{idx}].order")
        require_string(lane.get("title"), f"lanes[{idx}].title")
        require(lane.get("status") in {"blocked", "ready"}, f"lanes[{idx}].status mismatch")
        require_string(lane.get("owner"), f"lanes[{idx}].owner")
        require_string(lane.get("help_kind"), f"lanes[{idx}].help_kind")
        blockers = require_int(lane.get("blocking_input_count"), f"lanes[{idx}].blocking_input_count")
        blocker_sum += blockers
        require_number(lane.get("completion_percent"), f"lanes[{idx}].completion_percent")
        require_string(lane.get("first_blocker"), f"lanes[{idx}].first_blocker")
        require_string(lane.get("immediate_action"), f"lanes[{idx}].immediate_action")
        require_string(lane.get("agent_action_after_inputs"), f"lanes[{idx}].agent_action_after_inputs")
        require_bool(lane.get("agent_can_execute_now"), f"lanes[{idx}].agent_can_execute_now")
        require_bool(lane.get("agent_can_execute_after_inputs"), f"lanes[{idx}].agent_can_execute_after_inputs")
        require_list(lane.get("required_user_material"), f"lanes[{idx}].required_user_material")
        require_list(lane.get("blocked_until"), f"lanes[{idx}].blocked_until", min_len=1)
        require_list(lane.get("automation_commands"), f"lanes[{idx}].automation_commands", min_len=1)
        require_string(lane.get("source_probe_command"), f"lanes[{idx}].source_probe_command")
        require_string(lane.get("evidence_generator"), f"lanes[{idx}].evidence_generator")
        require_string(lane.get("strict_validator"), f"lanes[{idx}].strict_validator")
        require_string(lane.get("operator_packet_ref"), f"lanes[{idx}].operator_packet_ref")
        require_string(lane.get("source_output_path"), f"lanes[{idx}].source_output_path")
        if lane.get("lane_id") == "production_dns_https":
            commands = [str(command) for command in lane.get("automation_commands", [])]
            require(DNS_PLAN_PRIVATE_ENV_COMMAND in commands, "production_dns_https automation must use private-env DNS plan command")
            require(DNS_APPLY_PRIVATE_ENV_COMMAND in commands, "production_dns_https automation must use review-gated private-env DNS apply command")
            require(DNS_PLAN_LEGACY_COMMAND not in commands, "production_dns_https automation must not use legacy DNS plan command")
            require(DNS_APPLY_LEGACY_COMMAND not in commands, "production_dns_https automation must not use legacy DNS apply command")
    require(summary.get("blocking_input_count") == blocker_sum, "summary blocking_input_count must equal lane sum")
    require(summary.get("blocking_input_count") == missing_summary.get("blocking_input_count"), "blocking count must match missing input checklist")

    queue = require_list(data.get("immediate_user_help_queue"), "immediate_user_help_queue", min_len=4)
    require([item.get("lane_id") for item in queue if isinstance(item, dict)] == LANE_ORDER, "help queue order mismatch")
    for item in queue:
        require(isinstance(item, dict), "help queue item must be object")
        require_int(item.get("rank"), "help_queue.rank")
        require_string(item.get("ask"), "help_queue.ask")
        require_list(item.get("first_required_material"), "help_queue.first_required_material", min_len=1)

    not_current = require_list(data.get("not_current_blockers"), "not_current_blockers", min_len=6)
    for snippet in (
        "staging aggregate is already go",
        "Stripe sandbox is not the current blocker; live mode proof is required",
        "z.ai/OpenAI-compatible LLM is not the current blocker",
        "worker/crawler/migrate are backend runtime entrypoints, not release images",
        "manager is legacy local-only and not a release surface",
    ):
        require(snippet in not_current, f"not_current_blockers missing {snippet!r}")

    refs = data.get("source_refs")
    require(isinstance(refs, dict), "source_refs must be object")
    for key in ("missing_input_checklist", "source_runbook", "dns_packet", "billing_packet", "security_packet", "governance_packet"):
        require_string(refs.get(key), f"source_refs.{key}")

    for required in (
        "# Stage 1 Production Action Matrix",
        "non-clearing action matrix",
        "Release decision: `no_go`",
        "## Action Lanes",
        "## Immediate Help Queue",
        "## Lane Details",
        "## Not Current Blockers",
        "## Source JSON",
    ):
        require(required in markdown, f"markdown missing {required!r}")
    require(DNS_PLAN_PRIVATE_ENV_COMMAND in markdown, "markdown missing private-env DNS plan command")
    require(DNS_APPLY_PRIVATE_ENV_COMMAND in markdown, "markdown missing private-env DNS apply command")
    require(DNS_PLAN_LEGACY_COMMAND not in markdown, "markdown must not contain legacy DNS plan command")
    require(DNS_APPLY_LEGACY_COMMAND not in markdown, "markdown must not contain legacy DNS apply command")
    for lane_id in LANE_ORDER:
        require(lane_id in markdown, f"markdown missing lane {lane_id}")
    for value in (
        summary.get("stage1_gates_completed"),
        summary.get("stage1_gates_total"),
        summary.get("stage1_completion_percent"),
        summary.get("production_inputs_configured"),
        summary.get("production_inputs_total"),
        summary.get("production_inputs_completion_percent"),
        summary.get("blocking_input_count"),
        summary.get("source_probes_ready"),
        summary.get("source_probes_total"),
    ):
        require(str(value) in markdown, f"markdown missing summary token {value}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    parser.add_argument("--markdown", type=Path, default=DEFAULT_MARKDOWN)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_MISSING_INPUT_CHECKLIST)
    parser.add_argument("--source-runbook", type=Path, default=DEFAULT_SOURCE_RUNBOOK)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        validate_code_anchors()
        print("stage1 production action matrix contract passed")
        return 0
    try:
        validate_matrix(
            load_json(args.matrix),
            read_text(args.markdown),
            load_json(args.missing_input_checklist),
            load_json(args.source_runbook),
        )
    except ProductionActionMatrixValidationError as exc:
        raise SystemExit(f"stage1 production action matrix validation failed: {exc}") from exc
    print("stage1 production action matrix validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
