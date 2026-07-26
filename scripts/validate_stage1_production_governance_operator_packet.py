#!/usr/bin/env python3
"""Validate the non-clearing production governance/release operator packet."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-operator-packet.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_production_governance_operator_packet.py"
PROOF_HELPER = ROOT / "scripts" / "stage1_production_governance_proof.py"
PROOF_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_governance_proof.py"
SOURCE_PROBE = ROOT / "scripts" / "stage1_production_source_probe.py"
GOVERNANCE_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_governance_release_evidence.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

REQUIRED_COMPONENTS = ["activation", "abuse", "skill"]
REQUIRED_SECTIONS = {
    "activation": [
        "high_risk_rbac",
        "reviewer_rationale",
        "second_review",
        "audit_immutability",
        "activation_gates",
    ],
    "abuse": [
        "account_hold",
        "rate_limit",
        "spend_cap_or_kill_switch",
        "rbac_audit",
    ],
    "skill": [
        "owner_risk",
        "eval_suite",
        "safety_refs",
        "canary_metrics",
        "rollback_target",
        "release_notes",
    ],
}
EXPECTED_OUTPUTS = (
    "proof_candidate",
    "proof_diagnostic",
    "source",
    "source_diagnostic",
    "activation_review_audit",
    "abuse_throttle_hold",
    "skill_release_eval_canary",
)

GOVERNANCE_ENV_VARIABLES = [
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_REFS",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_HIGH_RISK_RBAC_REF",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_REVIEWER_RATIONALE_REF",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_SECOND_REVIEW_REF",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_IMMUTABILITY_REF",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_GATES_REF",
    "STAGE1_PROD_GOVERNANCE_ABUSE_RUNTIME_REQUEST_IDS",
    "STAGE1_PROD_GOVERNANCE_ABUSE_AUDIT_REFS",
    "STAGE1_PROD_GOVERNANCE_ABUSE_ACCOUNT_HOLD_REF",
    "STAGE1_PROD_GOVERNANCE_ABUSE_RATE_LIMIT_REF",
    "STAGE1_PROD_GOVERNANCE_ABUSE_SPEND_CAP_OR_KILL_SWITCH_REF",
    "STAGE1_PROD_GOVERNANCE_ABUSE_RBAC_AUDIT_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_RUNTIME_REQUEST_IDS",
    "STAGE1_PROD_GOVERNANCE_SKILL_AUDIT_REFS",
    "STAGE1_PROD_GOVERNANCE_SKILL_OWNER_ID",
    "STAGE1_PROD_GOVERNANCE_SKILL_RISK_LEVEL",
    "STAGE1_PROD_GOVERNANCE_SKILL_SUITE_ID",
    "STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_ID",
    "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_ID",
    "STAGE1_PROD_GOVERNANCE_SKILL_CANARY_SAMPLE_SIZE",
    "STAGE1_PROD_GOVERNANCE_SKILL_OWNER_RISK_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_EVAL_SUITE_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_SAFETY_REFS_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_CANARY_METRICS_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_REF",
]

OPERATOR_COMMAND_STEPS = [
    "run_private_env_proof_bundle",
    "validate_governance_candidate_or_diagnostic",
    "run_governance_source_probe_after_candidate_passes",
    "generate_strict_governance_evidence",
    "validate_strict_governance_evidence",
    "refresh_non_clearing_summary",
]

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


class GovernanceOperatorPacketValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GovernanceOperatorPacketValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise GovernanceOperatorPacketValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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
    require(isinstance(value, str) and value.strip(), f"{path} must be a non-empty string")
    return value.strip()


def string_list(value: Any, path: str) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    result: list[str] = []
    for idx, item in enumerate(value):
        result.append(require_string(item, f"{path}[{idx}]"))
    return result


def validate_code_anchors() -> None:
    require_text(
        GENERATOR,
        (
            "stage1.production_governance_operator_packet.v1",
            "production-governance-operator-packet.json",
            "production_governance_release",
            "production_activation_review_audit",
            "activation_gates",
            "production_abuse_throttle_hold",
            "spend_cap_or_kill_switch",
            "production_skill_release_eval_canary",
            "canary_metrics",
            "private_env_template",
            "operator_command_packet",
            "stage1_production_governance_proof.py",
            "stage1_production_source_probe.py --governance",
        ),
    )
    require_text(PROOF_HELPER, ("activation-runtime-request-ids", "abuse-runtime-request-ids", "skill-runtime-request-ids"))
    require_text(PROOF_VALIDATOR, ("COMPONENT_SECTIONS", "metrics_within_threshold", "go_no_go_recorded"))
    require_text(SOURCE_PROBE, ("build_governance_source", "--governance-proof", "production_governance_release_source"))
    require_text(GOVERNANCE_VALIDATOR, ("COMPONENTS", "can_clear_skill_release_eval_canary_component", "production_governance_release"))
    require_text(
        REPO_VALIDATE,
        (
            "generate_stage1_production_governance_operator_packet.py --contract-only",
            "validate_stage1_production_governance_operator_packet.py --contract-only",
            "production-governance-operator-packet.json",
        ),
    )


def validate_components(data: dict[str, Any]) -> None:
    components = data.get("required_governance_components")
    require(isinstance(components, list), "required_governance_components must be list")
    require(len(components) == len(REQUIRED_COMPONENTS), "required_governance_components length mismatch")
    seen: list[str] = []
    for idx, component in enumerate(components):
        require(isinstance(component, dict), f"required_governance_components[{idx}] must be object")
        name = require_string(component.get("component"), f"required_governance_components[{idx}].component")
        seen.append(name)
        require(name in REQUIRED_COMPONENTS, f"unexpected governance component {name}")
        require_string(component.get("release_gate_check_id"), f"{name}.release_gate_check_id")
        require_string(component.get("runtime_flag"), f"{name}.runtime_flag")
        require_string(component.get("audit_flag"), f"{name}.audit_flag")
        sections = component.get("required_section_refs")
        require(isinstance(sections, list), f"{name}.required_section_refs must be list")
        require(len(sections) == len(REQUIRED_SECTIONS[name]), f"{name}.required_section_refs length mismatch")
        section_seen: list[str] = []
        for section_idx, section in enumerate(sections):
            require(isinstance(section, dict), f"{name}.required_section_refs[{section_idx}] must be object")
            section_name = require_string(section.get("section"), f"{name}.required_section_refs[{section_idx}].section")
            section_seen.append(section_name)
            require(section_name in REQUIRED_SECTIONS[name], f"unexpected {name} section {section_name}")
            flag = require_string(section.get("flag"), f"{name}.{section_name}.flag")
            require(flag.startswith("--"), f"{name}.{section_name}.flag must be CLI flag")
            assertions = section.get("required_assertions")
            require(isinstance(assertions, dict) and assertions, f"{name}.{section_name}.required_assertions must be non-empty object")
        require(section_seen == REQUIRED_SECTIONS[name], f"{name}.required_section_refs order mismatch")
        if name == "skill":
            required_ids = component.get("required_ids")
            require(isinstance(required_ids, list) and len(required_ids) == 5, "skill.required_ids mismatch")
            for item in required_ids:
                require(isinstance(item, dict), "skill.required_ids item must be object")
                require_string(item.get("field"), "skill.required_ids.field")
                flag = require_string(item.get("flag"), "skill.required_ids.flag")
                require(flag.startswith("--skill-"), "skill.required_ids flag mismatch")
    require(seen == REQUIRED_COMPONENTS, "required_governance_components order mismatch")


def validate_packet(data: dict[str, Any]) -> None:
    assert_no_secret(data, "governance_operator_packet")
    require(data.get("schema_version") == "stage1.production_governance_operator_packet.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_governance_operator_packet", "kind mismatch")
    require(data.get("status") == "blocked", "operator packet must remain blocked")
    require(data.get("release_gate_check_id") == "production_governance_release", "release gate check mismatch")
    require(data.get("release_gate_decision") == "no_go", "operator packet must remain no_go")
    require(data.get("non_clearing_operator_packet") is True, "non_clearing_operator_packet must be true")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_production_governance_release") is False, "cannot clear governance")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "cannot close DNL")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    validate_components(data)

    private_env = data.get("private_env_template")
    require(isinstance(private_env, dict), "private_env_template must be object")
    require(private_env.get("path_placeholder") == "<private-production-env>", "private_env_template placeholder mismatch")
    require(private_env.get("gitignore_required") is True, "private_env_template must require gitignore")
    require(private_env.get("blank_values_only") is True, "private_env_template must be blank-values-only")
    allowed_variables = string_list(private_env.get("allowed_variable_names"), "private_env_template.allowed_variable_names")
    require(allowed_variables == GOVERNANCE_ENV_VARIABLES, "private_env_template allowed variables mismatch")
    template_lines = string_list(private_env.get("template_lines"), "private_env_template.template_lines")
    require(template_lines == [f"{name}=" for name in GOVERNANCE_ENV_VARIABLES], "private_env_template lines must be blank assignments")

    proof = data.get("proof")
    require(isinstance(proof, dict), "proof must be object")
    require(proof.get("candidate_path") == "ops/evidence/non_clearing/production-governance-proof.candidate.json", "proof candidate path mismatch")
    blocked = proof.get("blocked_diagnostic")
    require(isinstance(blocked, dict), "proof.blocked_diagnostic must be object")
    blocked_path = require_string(blocked.get("path"), "proof.blocked_diagnostic.path")
    require(
        blocked_path == "ops/evidence/non_clearing/production-governance-proof.blocked.json"
        or blocked_path.endswith("/production-governance-proof.blocked.json"),
        "proof blocked diagnostic path mismatch",
    )
    require(isinstance(blocked.get("exists"), bool), "proof blocked diagnostic exists must be bool")
    require_string(blocked.get("first_blocker"), "proof blocked diagnostic first_blocker")
    proof_command = require_string(proof.get("proof_generator_command"), "proof_generator_command")
    for token in (
        "stage1_production_governance_proof.py",
        "--activation-runtime-request-ids",
        "--abuse-runtime-request-ids",
        "--skill-runtime-request-ids",
        "--skill-canary-sample-size",
    ):
        require(token in proof_command, f"proof generator command missing {token}")
    require(
        "validate_stage1_production_governance_proof.py" in require_string(proof.get("proof_validator_command"), "proof_validator_command"),
        "proof validator command mismatch",
    )

    source = data.get("source_probe")
    require(isinstance(source, dict), "source_probe must be object")
    require(source.get("canonical_source_path") == "ops/evidence/production/production-governance-release-source.json", "source path mismatch")
    require(isinstance(source.get("canonical_source_exists"), bool), "canonical_source_exists must be bool")
    require("stage1_production_source_probe.py --governance" in require_string(source.get("source_probe_command"), "source_probe_command"), "source probe command mismatch")
    diagnostic = source.get("source_diagnostic")
    require(isinstance(diagnostic, dict), "source_diagnostic must be object")
    require(diagnostic.get("path") == "ops/evidence/production/source-probe-diagnostics.governance.json", "source diagnostic path mismatch")
    require(isinstance(diagnostic.get("exists"), bool), "source diagnostic exists must be bool")
    require_string(diagnostic.get("first_blocker"), "source diagnostic first_blocker")

    for key in ("blocked_until", "execution_order"):
        values = data.get(key)
        require(isinstance(values, list) and values, f"{key} must be non-empty list")
        for idx, value in enumerate(values):
            require(isinstance(value, str) and value.strip(), f"{key}[{idx}] must be non-empty string")
    order = "\n".join(data["execution_order"])
    for token in (
        "stage1_production_governance_proof.py",
        "validate_stage1_production_governance_proof.py",
        "stage1_production_source_probe.py --governance",
        "generate_stage1_production_governance_release_evidence.py",
        "validate_stage1_production_governance_release_evidence.py",
    ):
        require(token in order, f"execution_order missing {token}")

    outputs = data.get("evidence_outputs")
    require(isinstance(outputs, dict), "evidence_outputs must be object")
    for key in EXPECTED_OUTPUTS:
        require_string(outputs.get(key), f"evidence_outputs.{key}")

    operator_commands = data.get("operator_command_packet")
    require(isinstance(operator_commands, list) and len(operator_commands) == len(OPERATOR_COMMAND_STEPS), "operator_command_packet step count mismatch")
    seen_steps: list[str] = []
    for idx, row in enumerate(operator_commands):
        require(isinstance(row, dict), f"operator_command_packet[{idx}] must be object")
        step_id = require_string(row.get("step_id"), f"operator_command_packet[{idx}].step_id")
        seen_steps.append(step_id)
        command = require_string(row.get("command"), f"operator_command_packet[{idx}].command")
        side_effect = require_string(row.get("side_effect"), f"operator_command_packet[{idx}].side_effect")
        require(isinstance(row.get("may_write_canonical_source"), bool), f"operator_command_packet[{idx}].may_write_canonical_source must be bool")
        require(isinstance(row.get("requires_review"), bool), f"operator_command_packet[{idx}].requires_review must be bool")
        if step_id == "run_private_env_proof_bundle":
            require("<private-production-env>" in command, "proof bundle step must use private env placeholder")
            require("run_stage1_production_proof_bundle.py" in command, "proof bundle step must use bundle runner")
        if row["may_write_canonical_source"]:
            require(step_id == "run_governance_source_probe_after_candidate_passes", "only governance source probe may write canonical source")
            require("--write-canonical-source" in command, "canonical write step must be explicit")
            require(row["requires_review"] is True, "canonical write step must require review")
            require("after production governance proof passes" in side_effect, "canonical write side effect must be gated")
        else:
            require("--write-canonical-source" not in command, f"{step_id} must not write canonical source")
            require(row["requires_review"] is False, f"{step_id} review flag mismatch")
    require(seen_steps == OPERATOR_COMMAND_STEPS, "operator_command_packet order mismatch")

    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("preserved_release_gate_check_id") == "production_governance_release", "gate preservation mismatch")
    for key, value in gate.items():
        if key.startswith("can_clear_"):
            require(value is False, f"gate_impact.{key} must be false")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", type=Path, default=DEFAULT_PACKET)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.contract_only:
            validate_code_anchors()
            print("stage1 production governance operator packet contract passed")
            return 0
        validate_packet(load_json(args.packet))
    except GovernanceOperatorPacketValidationError as exc:
        raise SystemExit(f"stage1 production governance operator packet validation failed: {exc}") from exc
    print("stage1 production governance operator packet validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
