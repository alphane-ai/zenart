#!/usr/bin/env python3
"""Validate the Stage 0 Rev2 safety enforcement contract fixture."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
CONTRACT = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "safety_enforcement_contract.json"
SAFETY_RULES = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "safety_rules.json"
EVAL_SUITE = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "starter_eval_suite.json"
EVAL_RESULTS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "starter_eval_results.json"
QA_RESULTS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "qa_results.json"
TRACE_COMPLETENESS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "trace_completeness.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
MIGRATION = ROOT / "backend" / "migrations" / "0002_stage0_rev2_domains.sql"
STAGE0_SERVICE = ROOT / "backend" / "internal" / "stage0" / "services.go"
STAGE0_TEST = ROOT / "backend" / "internal" / "stage0" / "services_test.go"
RUNTIME_REPLAY = ROOT / "scripts" / "run_safety_policy_runtime_contract.py"

SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

SAFETY_ACTIONS = {
    "allow",
    "warn",
    "require_user_confirmation",
    "require_admin_review",
    "block",
}

ACTION_EXPORT_GATES = {
    "allow": "allow_when_export_contract_complete",
    "warn": "allow_with_warning",
    "require_user_confirmation": "hold_until_user_confirmation",
    "require_admin_review": "hold_until_admin_review",
    "block": "block_final_export",
}

SAFETY_ORDER = [
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
]

TRANSITION_SEQUENCE = [
    ("brief_completion", "brief", "brief_confirmed", {"tenant_id", "project_id"}, "deny_generation"),
    ("provider_request_dispatch", "provider_request", "provider_call", {"tenant_id", "task_id"}, "deny_provider_call"),
    ("provider_response_acceptance", "provider_response", "candidate_asset_acceptance", {"tenant_id", "task_id"}, "deny_asset_acceptance"),
    ("qa_completion", "qa", "package_export_allowed", {"tenant_id", "qa_subject_type", "qa_subject_id"}, "deny_qa_completion"),
    (
        "export_creation",
        "export",
        "export_task_created",
        {"tenant_id", "project_id", "qa_subject_type", "qa_subject_id", "export_id"},
        "deny_export_task",
    ),
    (
        "export_artifact_recording",
        "export",
        "downloadable_artifact_recorded",
        {"tenant_id", "project_id", "qa_subject_type", "qa_subject_id", "export_id"},
        "deny_downloadable_artifact",
    ),
]

FAIL_CLOSED_CASES = {
    "safety_missing_tenant_denies_policy": ("missing_tenant_id", "ErrValidation", False),
    "safety_missing_subject_denies_policy": ("missing_all_subjects", "ErrValidation", False),
    "safety_blocked_export_denies_task": ("blocked_export_rule", "ErrSafetyBlocked", True),
    "safety_review_hold_denies_transition": ("held_review_decision", "ErrSafetyReviewHold", True),
}

BYPASS_PREVENTION_CASES = {
    "safety_bypass_brief_completion_denied": (
        "brief_completion",
        "confirm_brief_without_policy_decision",
        "brief",
        "brief_confirmed",
        "ErrValidation",
    ),
    "safety_bypass_provider_request_dispatch_denied": (
        "provider_request_dispatch",
        "call_provider_without_provider_request_policy_decision",
        "provider_request",
        "provider_call",
        "ErrValidation",
    ),
    "safety_bypass_provider_response_acceptance_denied": (
        "provider_response_acceptance",
        "accept_asset_without_provider_response_policy_decision",
        "provider_response",
        "candidate_asset_acceptance",
        "ErrSafetyBlocked",
    ),
    "safety_bypass_qa_completion_denied": (
        "qa_completion",
        "mark_qa_complete_without_qa_policy_decision",
        "qa",
        "package_export_allowed",
        "ErrSafetyReviewHold",
    ),
    "safety_bypass_export_creation_denied": (
        "export_creation",
        "create_export_task_without_export_policy_decision",
        "export",
        "export_task_created",
        "ErrSafetyBlocked",
    ),
    "safety_bypass_export_artifact_recording_denied": (
        "export_artifact_recording",
        "record_downloadable_artifact_without_export_policy_decision",
        "export",
        "downloadable_artifact_recorded",
        "ErrSafetyBlocked",
    ),
}

OVERRIDE_DOWNGRADE_CASES = {
    "safety_override_block_to_admin_review_denied": (
        "fx_red_team_minor_adult_content",
        "block",
        "require_admin_review",
        "hold_until_admin_review",
        "ErrSafetyBlocked",
    ),
    "safety_override_block_to_warn_denied": (
        "fx_unsafe_financial_claim",
        "block",
        "warn",
        "allow_with_warning",
        "ErrSafetyBlocked",
    ),
    "safety_override_admin_review_to_warn_denied": (
        "fx_brand_product_preservation",
        "require_admin_review",
        "warn",
        "allow_with_warning",
        "ErrSafetyReviewHold",
    ),
    "safety_override_user_confirmation_to_allow_denied": (
        "fx_confirmation_sensitive_claim",
        "require_user_confirmation",
        "allow",
        "allow_when_export_contract_complete",
        "ErrSafetyReviewHold",
    ),
}

BACKEND_EVIDENCE_FILES = {
    "backend/internal/stage0/services.go": STAGE0_SERVICE,
    "backend/internal/stage0/services_test.go": STAGE0_TEST,
}


class SafetyContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SafetyContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SafetyContractError(message)


def schema_block(openapi_text: str, schema_name: str) -> str:
    match = re.search(
        rf"^    {schema_name}:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(match is not None, f"OpenAPI schema {schema_name} missing")
    return match.group("body")


def checked_items(text: str) -> set[str]:
    return {
        match.group(1)
        for match in re.finditer(r"^- \[x\] (.+)$", text, flags=re.MULTILINE)
    }


def unchecked_items(text: str) -> set[str]:
    return {
        match.group(1)
        for match in re.finditer(r"^- \[ \] (.+)$", text, flags=re.MULTILINE)
    }


def validate_fixture_links(contract: dict[str, Any]) -> None:
    suite = load_json(EVAL_SUITE)
    results = load_json(EVAL_RESULTS)
    qa_results = load_json(QA_RESULTS)
    traces = load_json(TRACE_COMPLETENESS)
    rules = load_json(SAFETY_RULES)

    fixture_by_id = {fixture["fixture_id"]: fixture for fixture in suite["fixtures"]}
    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    result_by_fixture = {item["fixture_id"]: item for item in results[0]["fixture_results"]}
    trace_by_fixture = {trace["fixture_id"]: trace for trace in traces["traces"]}
    qa_by_fixture: dict[str, list[dict[str, Any]]] = {}
    for item in qa_results:
        qa_by_fixture.setdefault(item["evidence"]["fixture_id"], []).append(item)

    linked_fixtures = {item["fixture_id"] for item in contract["fixture_links"]}
    rule_fixtures = set().union(*(set(rule["eval_fixture_links"]) for rule in rules))
    require(linked_fixtures <= rule_fixtures, f"safety contract fixture links missing rule refs: {sorted(linked_fixtures - rule_fixtures)}")

    for link in contract["fixture_links"]:
        fixture_id = link["fixture_id"]
        require(fixture_id in fixture_by_id, f"safety contract references unknown fixture {fixture_id}")
        require(fixture_id in result_by_fixture, f"safety contract fixture {fixture_id} missing eval result")
        require(fixture_id in trace_by_fixture, f"safety contract fixture {fixture_id} missing trace completeness")
        require(set(link["required_enforcement_points"]) == SAFETY_POINTS, f"{fixture_id} must require all safety points")

        expected_action = link["expected_safety_action"]
        fixture_action = fixture_by_id[fixture_id]["expected_evidence"]["expected_safety_action"]
        result_action = result_by_fixture[fixture_id]["observed_safety_action"]
        matching_rules = [
            rule for rule in rules if fixture_id in rule["eval_fixture_links"]
        ]
        require(matching_rules, f"{fixture_id} must link to at least one safety rule")
        require(
            any(rule["action"] == expected_action for rule in matching_rules),
            f"{fixture_id} must link to a {expected_action} safety rule",
        )
        decision_contract = result_by_fixture[fixture_id]["safety_decision_contract"]
        require(
            link["expected_decision_source"] == decision_contract["decision_source"],
            f"{fixture_id} safety decision source mismatch",
        )
        require(
            link["expected_source_rule_ids"] == decision_contract["source_rule_ids"],
            f"{fixture_id} safety decision source rule mismatch",
        )
        trace = trace_by_fixture[fixture_id]
        require(trace["trace_id"] == link["trace_id"], f"{fixture_id} trace id mismatch")
        require(trace["safety_status"]["present"] is True, f"{fixture_id} trace must include safety status")
        require(set(trace["covered_steps"]) == SAFETY_POINTS, f"{fixture_id} trace must cover every safety point")
        require(set(link["per_point_decision_refs"]) == SAFETY_POINTS, f"{fixture_id} decision refs must cover every safety point")
        events_by_step = {
            event["step_name"]: event
            for event in trace["step_events"]
        }
        require(set(events_by_step) >= SAFETY_POINTS, f"{fixture_id} trace events must cover every safety point")
        for point in link["required_enforcement_points"]:
            event = events_by_step[point]
            decision_ref = event["safety_decision_ref"]
            require(event["trace_id"] == link["trace_id"], f"{fixture_id} {point} trace id mismatch")
            require(event["safety_status"]["present"] is True, f"{fixture_id} {point} must include safety status")
            require(decision_ref["decision_id"] == link["per_point_decision_refs"][point], f"{fixture_id} {point} decision ref mismatch")
            require(decision_ref["table"] == "safety_decisions", f"{fixture_id} {point} must persist safety decision")
            require(decision_ref["enforcement_point"] == point, f"{fixture_id} {point} enforcement point mismatch")
            require(decision_ref["decision"] == expected_action, f"{fixture_id} {point} decision mismatch")
            require(
                decision_ref["decision_source"] == link["expected_decision_source"],
                f"{fixture_id} {point} decision source mismatch",
            )
            require(
                decision_ref["source_rule_ids"] == link["expected_source_rule_ids"],
                f"{fixture_id} {point} source rule mismatch",
            )
            require(decision_ref["audit_required"] is True, f"{fixture_id} {point} linked safety decision must require audit")
        if fixture_action != expected_action:
            require(
                decision_contract["decision"] == expected_action,
                f"{fixture_id} safety decision contract must preserve linked rule decision when suite default differs",
            )
        else:
            require(result_action == expected_action, f"{fixture_id} observed action mismatch in eval result")

        if link["must_block_final_export"]:
            result = result_by_fixture[fixture_id]
            require(result["status"] == "blocked", f"{fixture_id} must be blocked in eval results")
            require(result["export_contract"]["blocks_when_incomplete"] is True, f"{fixture_id} must block incomplete export")
            if fixture_id in qa_by_fixture:
                require(
                    any(item["export_gate"]["blocks_final_export"] is True for item in qa_by_fixture[fixture_id]),
                    f"{fixture_id} linked QA result must block final export",
                )


def validate_openapi_and_storage_contract(contract: dict[str, Any]) -> None:
    openapi = OPENAPI.read_text(encoding="utf-8")
    migration = MIGRATION.read_text(encoding="utf-8")
    service = STAGE0_SERVICE.read_text(encoding="utf-8")
    tests = STAGE0_TEST.read_text(encoding="utf-8")

    safety_rule = schema_block(openapi, "SafetyRule")
    safety_create = schema_block(openapi, "SafetyDecisionCreate")
    safety_decision = schema_block(openapi, "SafetyDecision")
    trace = schema_block(openapi, "AgentTrace")

    require("operationId: createSafetyDecision" in openapi, "OpenAPI must expose createSafetyDecision")
    require("x-idempotency-required: true" in openapi, "createSafetyDecision must require idempotency")
    for point in SAFETY_POINTS:
        for body_name, body in {
            "SafetyRule": safety_rule,
            "SafetyDecisionCreate": safety_create,
            "AgentTrace": trace,
        }.items():
            require(point in body, f"OpenAPI {body_name} missing enforcement point {point}")
    for field in ["tenant_id", "rule_id", "subject_type", "subject_id", "enforcement_point", "decision", "rationale"]:
        require(f"{field}:" in safety_decision, f"SafetyDecision schema missing {field}")

    storage = contract["decision_storage_contract"]
    require(f"CREATE TABLE IF NOT EXISTS {storage['table']}" in migration, "safety decision table missing")
    for column in storage["required_columns"]:
        require(column in migration, f"safety_decisions storage missing {column}")
    require("tenant_id text NOT NULL REFERENCES tenants(id)" in migration, "safety_decisions must be tenant scoped")
    require("rationale text NOT NULL" in migration, "safety_decisions must persist rationale")
    require("idx_safety_decisions_subject" in migration, "safety decisions must be subject-indexed")

    for token in [
        "func (r Repository) EnforceSafety",
        "func (r Repository) RequireSafetyAllowed",
        "func (r Repository) findActiveSafetyRule",
        "INSERT INTO safety_decisions",
        "EnforcementPoint",
        "Decision",
        "Rationale",
    ]:
        require(token in service, f"backend safety enforcement implementation missing {token}")
    for token in [
        "func (r Repository) CreateExport",
        "func (r Repository) RegenerateExport",
        "func (r Repository) RecordExportArtifact",
        "hasBlockingExportQA",
        "ErrSafetyBlocked",
    ]:
        require(token in service, f"export safety/QA block implementation missing {token}")
    for point in SAFETY_POINTS:
        require(f'SafetyPoint{_go_const_suffix(point)}' in service, f"backend safety point const missing {point}")
    for token in [
        "EnforceBriefSafety",
        "EnforceProviderRequestSafety",
        "EnforceProviderResponseSafety",
        "EnforceQASafety",
        "EnforceExportSafety",
    ]:
        require(token in service, f"backend safety enforcement helper missing {token}")
    baseline_tokens = [
        "TestEnforceSafetyRecordsBlockDecisionForActiveRule",
        "TestSafetyEnforcementHelpersCoverRev2RuntimePoints",
        "TestCreateExportBlocksWhenQAHasBlockingResult",
        "TestCreateExportBlocksWhenExportSafetyRuleBlocks",
        "TestRecordExportArtifactBlocksWhenExportSafetyRuleBlocks",
    ]
    for token in baseline_tokens:
        require(token in tests, f"backend safety contract test missing {token}")

    policy = contract["release_gate_policy"]
    runtime_tokens = [
        "ErrSafetyReviewHold",
        'case "require_user_confirmation", "require_admin_review"',
        "TestEnforceSafetyRecordsWarnConfirmationAndAdminReviewDecisions",
        "TestRequireSafetyAllowedHoldsForConfirmationAndAdminReview",
    ]
    if policy["runtime_enforcement_validated"]:
        require(
            "findBlockingRule" not in service,
            "validated safety runtime must evaluate every active action, not block-only rules",
        )
        for token in runtime_tokens[:2]:
            require(token in service, f"validated safety runtime missing {token}")
        for token in runtime_tokens[2:]:
            require(token in tests, f"validated safety runtime test missing {token}")
    else:
        require(
            "findBlockingRule" in service,
            "evidence-only safety contract must keep runtime checklist open while backend is block-only",
        )


def validate_cross_contracts(contract: dict[str, Any]) -> None:
    rules = load_json(SAFETY_RULES)
    traces = load_json(TRACE_COMPLETENESS)
    results = load_json(EVAL_RESULTS)
    suite = load_json(EVAL_SUITE)
    fixture_by_id = {fixture["fixture_id"]: fixture for fixture in suite["fixtures"]}
    rule_by_id = {rule["rule_id"]: rule for rule in rules}

    require(set(contract["required_enforcement_points"]) == SAFETY_POINTS, "contract required enforcement points mismatch")
    runtime_points = {item["enforcement_point"] for item in contract["runtime_contracts"]}
    require(runtime_points == SAFETY_POINTS, f"runtime contracts missing points: {sorted(SAFETY_POINTS - runtime_points)}")
    for item in contract["runtime_contracts"]:
        require(set(item["required_decision_actions"]) == SAFETY_ACTIONS, f"{item['enforcement_point']} must list every decision action")
        require(item["trace_status_required"] is True, f"{item['enforcement_point']} must require trace safety status")
        require(item["blocks_export_when_blocking"] is True, f"{item['enforcement_point']} must block export when blocking")
        require(item["openapi_operation"] == "createSafetyDecision", f"{item['enforcement_point']} must cite createSafetyDecision")

    for rule in rules:
        require(set(rule["enforcement_points"]) == SAFETY_POINTS, f"{rule['rule_id']} must cover all safety points")
        if rule["severity"] == "critical":
            require(rule["action"] == "block", f"{rule['rule_id']} critical rules must block")
            require(rule["admin_override_eligible"] is False, f"{rule['rule_id']} critical rules must not allow admin override")
        require(rule["audit_required"] is True, f"{rule['rule_id']} safety decisions must require audit")

    matrix_points = {item["enforcement_point"] for item in contract["decision_matrix"]}
    require(matrix_points == SAFETY_POINTS, f"decision matrix missing points: {sorted(SAFETY_POINTS - matrix_points)}")
    for item in contract["decision_matrix"]:
        actions = item["actions"]
        decisions_in_order = [action["decision"] for action in actions]
        require(
            decisions_in_order == ["allow", "warn", "require_user_confirmation", "require_admin_review", "block"],
            f"{item['enforcement_point']} decision matrix must preserve allow/warn/hold/block priority order",
        )
        decisions = {action["decision"] for action in actions}
        require(decisions == SAFETY_ACTIONS, f"{item['enforcement_point']} decision matrix must cover every action")
        for action in actions:
            decision = action["decision"]
            fixture_id = action["source_fixture_id"]
            rule_id = action["source_rule_id"]
            require(fixture_id in fixture_by_id, f"{item['enforcement_point']} {decision} references unknown fixture {fixture_id}")
            require(action["export_gate"] == ACTION_EXPORT_GATES[decision], f"{item['enforcement_point']} {decision} export gate mismatch")
            require(action["requires_trace_safety_status"] is True, f"{item['enforcement_point']} {decision} must require trace safety status")
            require(action["requires_persisted_decision"] is True, f"{item['enforcement_point']} {decision} must require persisted decision")
            if decision == "allow":
                require(rule_id == "default_no_match", f"{item['enforcement_point']} allow decision must use default_no_match")
                require(action["requires_audit"] is False, f"{item['enforcement_point']} allow decision must not require audit")
            else:
                require(rule_id in rule_by_id, f"{item['enforcement_point']} {decision} references unknown safety rule {rule_id}")
                rule = rule_by_id[rule_id]
                require(rule["action"] == decision, f"{rule_id} action must match decision matrix {decision}")
                require(fixture_id in rule["eval_fixture_links"], f"{rule_id} must link fixture {fixture_id}")
                require(action["requires_audit"] is True, f"{item['enforcement_point']} {decision} must require audit")
                require(item["enforcement_point"] in rule["enforcement_points"], f"{rule_id} missing matrix enforcement point {item['enforcement_point']}")

    require(set(traces["required_pipeline_steps"]) == SAFETY_POINTS, "trace contract pipeline steps must match safety enforcement points")
    for trace in traces["traces"]:
        require(trace["safety_status"]["present"] is True, f"{trace['trace_id']} must include safety status")
        require(set(trace["covered_steps"]) == SAFETY_POINTS, f"{trace['trace_id']} must cover every safety step")

    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    summary = results[0]["summary"]
    require(set(summary["safety_enforcement_points_covered"]) == SAFETY_POINTS, "eval result summary must cover every safety point")
    require(summary["critical_safety_regressions"] == 0, "eval result must have no critical safety regressions")
    for result in results[0]["fixture_results"]:
        require(result["trace_contract"]["has_safety_status"] is True, f"{result['fixture_id']} trace must include safety status")
        decision_contract = result["safety_decision_contract"]
        require(decision_contract["decision"] == result["observed_safety_action"], f"{result['fixture_id']} safety decision must match eval result")
        require(set(decision_contract["enforcement_points"]) == SAFETY_POINTS, f"{result['fixture_id']} safety decision must cover every point")
        for rule_id in decision_contract["source_rule_ids"]:
            require(rule_id in rule_by_id, f"{result['fixture_id']} safety decision references unknown rule {rule_id}")
            require(result["fixture_id"] in rule_by_id[rule_id]["eval_fixture_links"], f"{result['fixture_id']} safety decision rule link mismatch")


def validate_pipeline_sequence_contract(contract: dict[str, Any]) -> None:
    pipeline = contract["pipeline_sequence_contract"]
    traces = load_json(TRACE_COMPLETENESS)
    service = STAGE0_SERVICE.read_text(encoding="utf-8")
    tests = STAGE0_TEST.read_text(encoding="utf-8")

    require(pipeline["ordered_enforcement_points"] == SAFETY_ORDER, "safety pipeline order mismatch")
    require(
        traces["required_pipeline_steps"] == SAFETY_ORDER,
        "trace completeness required pipeline steps must preserve safety order",
    )
    for trace in traces["traces"]:
        require(trace["covered_steps"] == SAFETY_ORDER, f"{trace['trace_id']} covered safety steps must preserve order")

    transitions = pipeline["transition_gates"]
    require(len(transitions) == len(TRANSITION_SEQUENCE), "safety transition gate count mismatch")
    for index, (stage, point, must_run_before, fields, effect) in enumerate(TRANSITION_SEQUENCE):
        item = transitions[index]
        require(item["stage"] == stage, f"safety transition {index} stage mismatch")
        require(item["enforcement_point"] == point, f"{stage} enforcement point mismatch")
        require(item["must_run_before"] == must_run_before, f"{stage} must_run_before mismatch")
        require(set(item["required_subject_fields"]) == fields, f"{stage} subject field contract mismatch")
        require(item["blocked_or_held_effect"] == effect, f"{stage} blocked effect mismatch")
        require(item["downstream_artifacts_created_on_block"] is False, f"{stage} must fail closed")
        require(item["trace_status_required"] is True, f"{stage} must require trace safety status")

    ordered_service_tokens = [
        "EnforceBriefSafety(ctx, input.TenantID, input.ProjectID)",
        "EnforceProviderRequestSafety(ctx, input.TenantID, input.TaskID)",
        "EnforceProviderResponseSafety(ctx, input.TenantID, input.TaskID)",
        "EnforceQASafety(ctx, input.TenantID, input.QASubjectType, input.QASubjectID)",
        "EnforceExportSafety(ctx, input.TenantID, input.ExportID)",
    ]
    previous = -1
    for token in ordered_service_tokens:
        current = service.find(token)
        require(current > previous, f"RunRuntimeSafetyPolicy must enforce ordered step {token}")
        previous = current
    require("IncludeProvider && input.TaskID != \"\"" in service, "provider safety steps must be gated by explicit provider inclusion")

    create_export_safety = service.find("RunRuntimeSafetyPolicy(ctx, RuntimeSafetyPolicyInput{")
    create_task = service.find("INSERT INTO agent_tasks", create_export_safety)
    require(create_export_safety != -1 and create_task != -1 and create_export_safety < create_task, "CreateExport must run safety before creating export task")
    record_artifact_safety = service.find("RunRuntimeSafetyPolicy(ctx, RuntimeSafetyPolicyInput{", service.find("func (r Repository) RecordExportArtifact"))
    record_update = service.find("UPDATE exports", record_artifact_safety)
    require(record_artifact_safety != -1 and record_update != -1 and record_artifact_safety < record_update, "RecordExportArtifact must run safety before recording downloadable artifact")

    fail_cases = {case["case_id"]: case for case in pipeline["fail_closed_cases"]}
    require(set(fail_cases) == set(FAIL_CLOSED_CASES), "safety fail-closed case ids mismatch")
    for case_id, (gap, expected_error, decision_required) in FAIL_CLOSED_CASES.items():
        case = fail_cases[case_id]
        require(case["input_gap"] == gap, f"{case_id} input gap mismatch")
        require(case["expected_error"] == expected_error, f"{case_id} expected error mismatch")
        require(case["creates_downstream_artifacts"] is False, f"{case_id} must not create downstream artifacts")
        require(
            case["decision_rows_required_before_error"] is decision_required,
            f"{case_id} decision-row requirement mismatch",
        )

    for token in [
        "TestRunRuntimeSafetyPolicyCoversAllRev2RuntimePoints",
        "TestRunRuntimeSafetyPolicyRequiresAtLeastOneSubject",
        "TestCreateExportBlocksWhenExportSafetyRuleBlocks",
        "TestRecordExportArtifactBlocksWhenExportSafetyRuleBlocks",
        "TestRequireSafetyAllowedHoldsForConfirmationAndAdminReview",
        "INSERT INTO agent_tasks",
        "want ErrSafetyBlocked",
        "want ErrSafetyReviewHold",
        "want ErrValidation",
    ]:
        require(token in tests, f"safety fail-closed backend test evidence missing {token}")

    validate_bypass_prevention_cases(pipeline, service, tests)
    validate_override_downgrade_cases(pipeline)


def validate_runtime_replay_contract(contract: dict[str, Any]) -> None:
    replay = contract["runtime_replay_contract"]
    require(
        replay["runner"] == "scripts/run_safety_policy_runtime_contract.py",
        "safety runtime replay runner mismatch",
    )
    require(replay["mode"] == "deterministic_fixture_replay", "safety runtime replay mode mismatch")
    require(replay["status"] == "pass", "safety runtime replay must pass")
    require(replay["transition_gate_cases_replayed"] == len(TRANSITION_SEQUENCE), "transition replay count mismatch")
    require(replay["decision_matrix_cases_replayed"] == len(SAFETY_POINTS) * len(SAFETY_ACTIONS), "decision replay count mismatch")
    require(replay["fail_closed_cases_replayed"] == len(FAIL_CLOSED_CASES), "fail-closed replay count mismatch")
    require(replay["bypass_prevention_cases_replayed"] == len(BYPASS_PREVENTION_CASES), "bypass replay count mismatch")
    require(
        replay["override_downgrade_cases_replayed"] == len(OVERRIDE_DOWNGRADE_CASES),
        "override downgrade replay count mismatch",
    )
    require(replay["fixture_link_cases_replayed"] == len(contract["fixture_links"]), "fixture-link replay count mismatch")
    require(
        replay["fixture_link_point_decision_refs_replayed"] == len(contract["fixture_links"]) * len(SAFETY_POINTS),
        "fixture-link point decision ref replay count mismatch",
    )
    require(replay["transition_points_replayed"] is True, "runtime replay must validate transition enforcement points")
    require(replay["decision_priority_order_validated"] is True, "runtime replay must validate decision priority order")
    require(
        replay["held_or_blocked_require_audit_for_all_actions"] is True,
        "runtime replay must validate audit requirements for held/blocking actions",
    )
    require(replay["blocked_or_held_creates_downstream_artifacts"] is False, "blocked/held replay must fail closed")
    require(replay["trace_status_required_for_all_transitions"] is True, "runtime replay must require trace status")
    require(replay["persisted_decision_required_for_all_actions"] is True, "runtime replay must require persisted decisions")
    require(replay["trace_decision_refs_replayed"] is True, "runtime replay must validate trace decision refs")

    result = subprocess.run(
        [sys.executable, str(RUNTIME_REPLAY)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "safety policy runtime replay failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_override_downgrade_cases(pipeline: dict[str, Any]) -> None:
    results = load_json(EVAL_RESULTS)
    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    result_by_fixture = {
        item["fixture_id"]: item
        for item in results[0]["fixture_results"]
    }
    cases = {
        case["case_id"]: case
        for case in pipeline["override_downgrade_prevention_cases"]
    }
    require(set(cases) == set(OVERRIDE_DOWNGRADE_CASES), "safety override downgrade case ids mismatch")

    for case_id, (
        fixture_id,
        original_decision,
        attempted_decision,
        attempted_export_gate,
        expected_error,
    ) in OVERRIDE_DOWNGRADE_CASES.items():
        case = cases[case_id]
        require(case["fixture_id"] == fixture_id, f"{case_id} fixture mismatch")
        require(fixture_id in result_by_fixture, f"{case_id} references unknown eval fixture")
        result = result_by_fixture[fixture_id]
        require(
            result["safety_decision_contract"]["decision"] == original_decision,
            f"{case_id} original eval safety decision mismatch",
        )
        require(case["original_decision"] == original_decision, f"{case_id} original decision mismatch")
        require(case["attempted_override_decision"] == attempted_decision, f"{case_id} attempted decision mismatch")
        require(case["attempted_export_gate"] == attempted_export_gate, f"{case_id} attempted export gate mismatch")
        require(case["expected_error"] == expected_error, f"{case_id} expected error mismatch")
        require(case["final_export_allowed"] is False, f"{case_id} must keep final export denied")
        require(case["requires_admin_audit"] is True, f"{case_id} must require audit")
        require(case["creates_downstream_artifacts"] is False, f"{case_id} must fail closed")
        require(case["trace_status_required"] is True, f"{case_id} must require trace status")
        require(
            case["persisted_original_decision_required"] is True,
            f"{case_id} must preserve the persisted original decision",
        )
        require(
            result["qa_export_gate"]["final_export_allowed"] is False,
            f"{case_id} source fixture must be export-denied",
        )


def validate_bypass_prevention_cases(pipeline: dict[str, Any], service: str, tests: str) -> None:
    transitions_by_stage = {
        transition["stage"]: transition
        for transition in pipeline["transition_gates"]
    }
    cases = {
        case["case_id"]: case
        for case in pipeline["bypass_prevention_cases"]
    }
    require(set(cases) == set(BYPASS_PREVENTION_CASES), "safety bypass-prevention case ids mismatch")

    seen_transitions: set[str] = set()
    seen_points: set[str] = set()
    for case_id, (
        stage,
        attempted_bypass,
        skipped_point,
        downstream_transition,
        expected_error,
    ) in BYPASS_PREVENTION_CASES.items():
        case = cases[case_id]
        transition = transitions_by_stage[stage]
        require(case["transition_stage"] == stage, f"{case_id} transition stage mismatch")
        require(case["attempted_bypass"] == attempted_bypass, f"{case_id} bypass attempt mismatch")
        require(case["skipped_enforcement_point"] == skipped_point, f"{case_id} skipped point mismatch")
        require(
            case["skipped_enforcement_point"] == transition["enforcement_point"],
            f"{case_id} skipped point must match transition enforcement point",
        )
        require(
            case["attempted_downstream_transition"] == downstream_transition,
            f"{case_id} downstream transition mismatch",
        )
        require(
            case["attempted_downstream_transition"] == transition["must_run_before"],
            f"{case_id} downstream transition must match the transition gate",
        )
        require(case["expected_error"] == expected_error, f"{case_id} expected error mismatch")
        require(case["creates_downstream_artifacts"] is False, f"{case_id} must not create downstream artifacts")
        require(case["trace_status_required"] is True, f"{case_id} must require trace safety status")
        require(
            transition["downstream_artifacts_created_on_block"] is False,
            f"{case_id} transition gate must fail closed",
        )
        require(
            transition["trace_status_required"] is True,
            f"{case_id} transition gate must require trace status",
        )
        seen_transitions.add(stage)
        seen_points.add(skipped_point)
        validate_backend_evidence(case_id, case["backend_evidence"], service, tests)

    require(seen_transitions == set(transitions_by_stage), "bypass cases must cover every transition gate")
    require(seen_points == SAFETY_POINTS, "bypass cases must cover every safety enforcement point")


def validate_backend_evidence(case_id: str, evidence_refs: list[str], service: str, tests: str) -> None:
    require(len(evidence_refs) >= 2, f"{case_id} must cite backend implementation and test evidence")
    for ref in evidence_refs:
        path, _, token = ref.partition(":")
        require(path in BACKEND_EVIDENCE_FILES, f"{case_id} evidence path is outside backend safety contract scope: {path}")
        require(token, f"{case_id} evidence ref must include a token after ':'")
        content = service if path.endswith("services.go") else tests
        require(token in content, f"{case_id} backend evidence token missing: {ref}")

    require(
        any(ref.startswith("backend/internal/stage0/services.go:") for ref in evidence_refs),
        f"{case_id} must cite backend implementation evidence",
    )
    require(
        any(ref.startswith("backend/internal/stage0/services_test.go:") for ref in evidence_refs),
        f"{case_id} must cite backend test evidence",
    )


def validate_release_policy(contract: dict[str, Any]) -> None:
    blueprint = BLUEPRINT.read_text(encoding="utf-8")
    checked = checked_items(blueprint)
    unchecked = unchecked_items(blueprint)
    item = "在 brief/provider request/provider response/QA/export 运行 safety policy。"

    policy = contract["release_gate_policy"]
    runtime_validated = policy["runtime_enforcement_validated"]
    if runtime_validated:
        require(policy["contract_evidence_only"] is False, "validated safety runtime must not be evidence-only")
        require(policy["blueprint_runtime_item_remains_open"] is False, "validated safety runtime must allow checklist closure")
        require(item in checked, "safety runtime checklist item must be checked after backend runtime enforcement")
        require(item not in unchecked, "safety runtime checklist item must not remain open after backend runtime enforcement")
    else:
        require(policy["contract_evidence_only"] is True, "unvalidated safety runtime must remain evidence-only")
        require(policy["blueprint_runtime_item_remains_open"] is True, "unvalidated safety runtime must keep checklist open")
        require(item in unchecked, "safety runtime checklist item must remain open until runtime evidence passes")
        require(item not in checked, "safety runtime checklist item must not be checked before runtime evidence passes")


def _go_const_suffix(point: str) -> str:
    if point == "qa":
        return "QA"
    return "".join(part.title() for part in point.split("_"))


def main() -> int:
    try:
        contract = load_json(CONTRACT)
        require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "contract must cite Rev2 blueprint")
        validate_cross_contracts(contract)
        validate_pipeline_sequence_contract(contract)
        validate_runtime_replay_contract(contract)
        validate_fixture_links(contract)
        validate_openapi_and_storage_contract(contract)
        validate_release_policy(contract)
    except SafetyContractError as exc:
        print(f"safety enforcement contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("safety enforcement contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
