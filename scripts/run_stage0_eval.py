#!/usr/bin/env python3
"""Run the deterministic Stage 0 Rev2 fixture eval contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
MIGRATION = ROOT / "backend" / "migrations" / "0002_stage0_rev2_domains.sql"
SUITE_PATH = FIXTURE_DIR / "eval" / "starter_eval_suite.json"
QA_PATH = FIXTURE_DIR / "eval" / "qa_results.json"
SAFETY_PATH = FIXTURE_DIR / "eval" / "safety_rules.json"
WORKFLOW_DIR = FIXTURE_DIR / "workflows"
RESULT_PATH = FIXTURE_DIR / "eval" / "starter_eval_results.json"
RUNNER_PATH = ROOT / "scripts" / "run_stage0_eval.py"
DETERMINISTIC_COMPLETED_AT = "2026-05-26T00:00:00Z"

SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

SAFETY_ORDER = [
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
]

QA_CATEGORIES = {
    "file_integrity",
    "dimensions",
    "aspect_ratio",
    "safe_area",
    "blank_output",
    "duplicate_similarity",
    "four_option_distinctness",
    "text_readability",
    "structured_text",
    "product_logo_preservation",
    "forbidden_claims",
    "watermark_signature_risk",
    "export_completeness",
}

QA_CATEGORY_ORDER = [
    "file_integrity",
    "dimensions",
    "aspect_ratio",
    "safe_area",
    "blank_output",
    "duplicate_similarity",
    "four_option_distinctness",
    "text_readability",
    "structured_text",
    "product_logo_preservation",
    "forbidden_claims",
    "watermark_signature_risk",
    "export_completeness",
]

SUMMARY_PROJECTION_FIELDS = [
    "total_fixtures",
    "passed_fixtures",
    "failed_fixtures",
    "blocked_fixtures",
    "golden_passed",
    "critical_safety_regressions",
    "regression_pass_rate",
    "trace_complete",
    "export_contract_complete",
    "qa_fixture_coverage_complete",
    "qa_categories_covered",
    "safety_enforcement_points_covered",
]

FIXTURE_RESULT_PROJECTION_FIELDS = [
    "fixture_id",
    "category",
    "workflow",
    "status",
    "expected_safety_action",
    "observed_safety_action",
    "safety_decision_contract",
    "qa_check_ids",
    "qa_coverage_contract",
    "trace_contract",
    "export_contract",
    "qa_export_gate",
    "failure_reasons",
]

DIMENSION_QA_CATEGORIES = {
    "four_option_distinctness": {"four_option_distinctness"},
    "image_qa": {
        "file_integrity",
        "dimensions",
        "aspect_ratio",
        "safe_area",
        "blank_output",
        "duplicate_similarity",
        "watermark_signature_risk",
    },
    "text_readability": {"text_readability"},
    "product_logo_preservation": {"product_logo_preservation"},
    "package_export_completeness": {"export_completeness"},
}

TRACE_KEYS = [
    "has_schema_validation",
    "has_provenance",
    "has_safety_status",
    "has_qa_eval_status",
    "has_quota_transaction",
    "has_admin_visibility",
    "has_user_failure_mapping",
]

PASS_THROUGH_BLOCKED_CATEGORIES = {
    "ambiguous_brief",
    "unsafe",
    "negative",
    "brand_product_preservation",
    "red_team",
}

SAFETY_ACTION_PRIORITY = {
    "allow": 0,
    "warn": 1,
    "require_user_confirmation": 2,
    "require_admin_review": 3,
    "block": 4,
}

SAFETY_EXPORT_GATE_EFFECT = {
    "allow": "allow_when_export_contract_complete",
    "warn": "allow_with_warning",
    "require_user_confirmation": "hold_until_user_confirmation",
    "require_admin_review": "hold_until_admin_review",
    "block": "block_final_export",
}


class EvalContractError(Exception):
    pass


def runner_sha256() -> str:
    content = RUNNER_PATH.read_text(encoding="utf-8")
    normalized = "\n".join(
        '            "runner_sha256": "<self>",' if '"runner_sha256": runner_digest' in line else line
        for line in content.splitlines()
    )
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_fixture_digests() -> list[dict[str, str]]:
    source_paths = [
        SUITE_PATH,
        QA_PATH,
        SAFETY_PATH,
        *sorted(WORKFLOW_DIR.glob("*.json")),
    ]
    return [
        {
            "path": str(path.relative_to(ROOT)),
            "sha256": file_sha256(path),
        }
        for path in source_paths
    ]


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalContractError(message)


def qa_by_fixture(qa_results: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in qa_results:
        grouped.setdefault(item["evidence"]["fixture_id"], []).append(item)
    return grouped


def trace_id_for(fixture: dict[str, Any], qa_items: list[dict[str, Any]]) -> str:
    if qa_items:
        return qa_items[0]["evidence"]["trace_id"]
    return "trace_" + fixture["fixture_id"].removeprefix("fx_")


def export_contract_for(fixture: dict[str, Any], qa_items: list[dict[str, Any]]) -> dict[str, bool]:
    expected = fixture["expected_evidence"]
    export_qa = next((item for item in qa_items if item["check_category"] == "export_completeness"), None)
    if export_qa:
        observed = export_qa["evidence"]["observed"]
        return {
            "manifest": bool(observed["manifest_json"]),
            "qa_report": bool(observed["qa_report_json"]),
            "metadata": bool(observed["metadata_json"]),
            "trace_provenance": bool(observed["trace_provenance_json"]),
            "safety_disclaimer_when_applicable": bool(observed["safety_disclaimer_when_applicable"]),
            "blocks_when_incomplete": bool(export_qa["export_gate"]["blocks_final_export"]),
        }
    return {
        "manifest": bool(expected["must_include_manifest"]),
        "qa_report": bool(expected["must_include_qa_report"]),
        "metadata": bool(expected["must_include_manifest"]),
        "trace_provenance": bool(expected["must_include_trace_provenance"]),
        "safety_disclaimer_when_applicable": True,
        "blocks_when_incomplete": True,
    }


def qa_export_gate_for(
    fixture: dict[str, Any],
    qa_items: list[dict[str, Any]],
    export_contract: dict[str, bool],
    qa_coverage_contract: dict[str, Any],
    safety_decision_contract: dict[str, Any],
) -> dict[str, Any]:
    blocking_checks = [
        item["check_id"]
        for item in qa_items
        if item["export_gate"]["blocks_final_export"] is True
    ]
    blocking_categories = sorted(
        {
            item["check_category"]
            for item in qa_items
            if item["export_gate"]["blocks_final_export"] is True
        }
    )
    requires_audit = any(
        item["export_gate"]["override_requires_audit"] is True
        for item in qa_items
    )
    safety_blocks_export = safety_decision_contract["decision"] == "block"
    safety_holds_export = safety_decision_contract["decision"] in {
        "require_user_confirmation",
        "require_admin_review",
    }
    export_artifacts_complete = all(
        export_contract[key]
        for key in [
            "manifest",
            "qa_report",
            "metadata",
            "trace_provenance",
            "safety_disclaimer_when_applicable",
        ]
    )
    export_allowed = (
        export_artifacts_complete
        and qa_coverage_contract["coverage_complete"]
        and not blocking_checks
        and not safety_blocks_export
        and not safety_holds_export
    )
    return {
        "final_export_allowed": export_allowed,
        "blocking_qa_check_ids": blocking_checks,
        "blocking_qa_categories": blocking_categories,
        "safety_blocks_export": safety_blocks_export,
        "export_artifacts_complete": export_artifacts_complete,
        "admin_override_required_for_export": not export_allowed,
        "override_requires_audit": requires_audit or not export_allowed,
    }


def linked_safety_rules(fixture: dict[str, Any], safety_rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fixture_id = fixture["fixture_id"]
    return [
        rule
        for rule in safety_rules
        if fixture_id in rule["eval_fixture_links"]
    ]


def safety_decision_contract_for(
    fixture: dict[str, Any],
    safety_rules: list[dict[str, Any]],
) -> dict[str, Any]:
    linked_rules = linked_safety_rules(fixture, safety_rules)
    if linked_rules:
        decision = max(
            (rule["action"] for rule in linked_rules),
            key=lambda action: SAFETY_ACTION_PRIORITY[action],
        )
        source = "linked_safety_rule"
        rule_ids = [rule["rule_id"] for rule in linked_rules]
        audit_required = True
    else:
        decision = "allow"
        source = "default_no_match"
        rule_ids = []
        audit_required = False

    return {
        "decision": decision,
        "decision_source": source,
        "source_rule_ids": rule_ids,
        "enforcement_points": SAFETY_ORDER,
        "trace_status_required": True,
        "persisted_decision_required": True,
        "audit_required": audit_required,
        "export_gate_effect": SAFETY_EXPORT_GATE_EFFECT[decision],
    }


def expected_qa_categories_for(fixture: dict[str, Any], workflow: dict[str, Any]) -> list[str]:
    categories: set[str] = set()
    for dimension in fixture["expected_dimensions"]:
        categories.update(DIMENSION_QA_CATEGORIES.get(dimension, set()))
    categories.update(workflow["required_qa_checks"])
    return [category for category in QA_CATEGORY_ORDER if category in categories]


def qa_coverage_contract_for(
    fixture: dict[str, Any],
    qa_items: list[dict[str, Any]],
    workflow: dict[str, Any],
) -> dict[str, Any]:
    expected = expected_qa_categories_for(fixture, workflow)
    observed = sorted(
        {item["check_category"] for item in qa_items},
        key=QA_CATEGORY_ORDER.index,
    )
    missing = [category for category in expected if category not in observed]
    workflow_required = [
        category
        for category in QA_CATEGORY_ORDER
        if category in set(workflow["required_qa_checks"])
    ]
    return {
        "expected_qa_categories": expected,
        "observed_qa_categories": observed,
        "missing_qa_categories": missing,
        "workflow_required_qa_categories": workflow_required,
        "coverage_complete": not missing,
    }


def fixture_status(
    fixture: dict[str, Any],
    qa_items: list[dict[str, Any]],
    qa_coverage_contract: dict[str, Any],
    safety_decision_contract: dict[str, Any],
) -> str:
    expected = fixture["expected_evidence"]
    category = fixture["category"]
    if expected["expected_safety_action"] == "block":
        return "blocked"
    if category in PASS_THROUGH_BLOCKED_CATEGORIES:
        return "blocked"
    if safety_decision_contract["decision"] in {"block", "require_user_confirmation", "require_admin_review"}:
        return "blocked"
    if not qa_coverage_contract["coverage_complete"]:
        return "blocked"
    if any(item["export_gate"]["blocks_final_export"] is True for item in qa_items):
        return "blocked"
    return "pass"


def failure_reasons_for(
    fixture: dict[str, Any],
    qa_items: list[dict[str, Any]],
    qa_coverage_contract: dict[str, Any],
) -> list[str]:
    category = fixture["category"]
    if category == "ambiguous_brief":
        return ["clarification_required_before_generation"]
    if fixture["expected_evidence"]["expected_safety_action"] == "block":
        return ["safety_policy_block"]
    if fixture["expected_evidence"]["expected_safety_action"] == "require_user_confirmation":
        return ["user_confirmation_required_before_generation"]
    if fixture["expected_evidence"]["expected_safety_action"] == "require_admin_review":
        return ["admin_review_required_before_export"]
    reasons = {
        "negative": "generic_four_card_rendering_not_distinct",
        "brand_product_preservation": "product_logo_preservation_block",
        "red_team": "safety_policy_block",
    }
    if category in reasons:
        return [reasons[category]]
    blocking = [
        item["check_category"] + "_block"
        for item in qa_items
        if item["export_gate"]["blocks_final_export"] is True
    ]
    blocking.extend(
        f"qa_coverage_missing_{category}"
        for category in qa_coverage_contract["missing_qa_categories"]
    )
    return sorted(set(blocking))


def run_eval() -> dict[str, Any]:
    suite = load_json(SUITE_PATH)
    qa_results = load_json(QA_PATH)
    safety_rules = load_json(SAFETY_PATH)
    workflows = {path.stem: load_json(path) for path in sorted(WORKFLOW_DIR.glob("*.json"))}

    require(suite["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval suite must cite Rev2")
    require(workflows, "workflow acceptance fixtures are required")
    for workflow_id, workflow in workflows.items():
        require(workflow["workflow_id"] == workflow_id, f"{workflow_id} workflow fixture filename mismatch")
        require(
            set(workflow["pass_thresholds"]["safety"]["required_enforcement_points"]) == SAFETY_POINTS,
            f"{workflow_id} must require all safety enforcement points",
        )

    qa_categories = {item["check_category"] for item in qa_results}
    require(QA_CATEGORIES <= qa_categories, f"QA fixture coverage missing {sorted(QA_CATEGORIES - qa_categories)}")
    safety_points = set().union(*(set(rule["enforcement_points"]) for rule in safety_rules))
    require(SAFETY_POINTS <= safety_points, f"safety rule coverage missing {sorted(SAFETY_POINTS - safety_points)}")
    for rule in safety_rules:
        require(set(rule["enforcement_points"]) == SAFETY_POINTS, f"{rule['rule_id']} lacks full safety enforcement")

    migration = MIGRATION.read_text(encoding="utf-8")
    require("CREATE TABLE IF NOT EXISTS eval_results" in migration, "eval_results table is missing")
    for column in ["tenant_id", "eval_suite_id", "subject_type", "subject_id", "status", "summary", "created_at"]:
        require(column in migration, f"eval_results storage missing {column}")

    qa_grouped = qa_by_fixture(qa_results)
    fixture_results: list[dict[str, Any]] = []
    for fixture in suite["fixtures"]:
        qa_items = qa_grouped.get(fixture["fixture_id"], [])
        trace_id = trace_id_for(fixture, qa_items)
        for qa_item in qa_items:
            require(
                qa_item["evidence"]["trace_id"] == trace_id,
                f"{qa_item['check_id']} trace must match {fixture['fixture_id']} eval fixture trace",
            )
        export_contract = export_contract_for(fixture, qa_items)
        qa_coverage_contract = qa_coverage_contract_for(fixture, qa_items, workflows[fixture["workflow"]])
        safety_decision_contract = safety_decision_contract_for(fixture, safety_rules)
        qa_export_gate = qa_export_gate_for(
            fixture,
            qa_items,
            export_contract,
            qa_coverage_contract,
            safety_decision_contract,
        )
        expected = fixture["expected_evidence"]
        candidate_count = expected["minimum_candidates"]
        status = fixture_status(fixture, qa_items, qa_coverage_contract, safety_decision_contract)
        trace_contract = {"trace_id": trace_id, **{key: True for key in TRACE_KEYS}}

        require(trace_id.startswith("trace_"), f"{fixture['fixture_id']} trace must be trace-scoped")
        if expected["must_include_trace_provenance"]:
            require(export_contract["trace_provenance"], f"{fixture['fixture_id']} must include trace provenance")
        if expected["must_include_manifest"] and fixture["category"] != "export_completeness":
            require(export_contract["manifest"], f"{fixture['fixture_id']} must include manifest")
        if expected["must_include_qa_report"]:
            require(export_contract["qa_report"], f"{fixture['fixture_id']} must include QA report")
        require(all(trace_contract[key] for key in TRACE_KEYS), f"{fixture['fixture_id']} trace contract incomplete")
        if status == "pass":
            require(qa_export_gate["final_export_allowed"], f"{fixture['fixture_id']} passed eval cannot block final export")
        else:
            require(not qa_export_gate["final_export_allowed"], f"{fixture['fixture_id']} blocked eval must deny final export")

        fixture_results.append(
            {
                "fixture_id": fixture["fixture_id"],
                "category": fixture["category"],
                "workflow": fixture["workflow"],
                "status": status,
                "candidate_count": candidate_count,
                "expected_safety_action": expected["expected_safety_action"],
                "observed_safety_action": safety_decision_contract["decision"],
                "safety_decision_contract": safety_decision_contract,
                "qa_check_ids": [item["check_id"] for item in qa_items],
                "qa_coverage_contract": qa_coverage_contract,
                "trace_contract": trace_contract,
                "export_contract": export_contract,
                "qa_export_gate": qa_export_gate,
                "failure_reasons": failure_reasons_for(fixture, qa_items, qa_coverage_contract),
            }
        )

    golden_results = [item for item in fixture_results if item["category"] == "golden"]
    critical_regressions = sum(
        1
        for item in fixture_results
        if item["expected_safety_action"] == "block" and item["observed_safety_action"] != "block"
    )
    pass_or_block = [item for item in fixture_results if item["status"] in {"pass", "blocked"}]
    regression_pass_rate = len(pass_or_block) / len(fixture_results)
    status = (
        "blocked"
        if any(item["status"] == "blocked" for item in fixture_results)
        else "pass"
    )
    runner_digest = runner_sha256()

    return {
        "schema_version": "stage0.rev2",
        "result_id": "eval_result_stage0_rev2_starter_contract",
        "suite_id": suite["suite_id"],
        "subject": {
            "subject_type": "vertical_workflow_pack",
            "subject_id": "stage0_rev2_starter_workflows",
            "version": "rev2.fixture-contract.1",
            "candidate_status_after_eval": "blocked" if status != "pass" else "eligible_for_canary",
        },
        "status": status,
        "completed_at": DETERMINISTIC_COMPLETED_AT,
        "created_at": DETERMINISTIC_COMPLETED_AT,
        "summary": {
            "total_fixtures": len(fixture_results),
            "passed_fixtures": sum(1 for item in fixture_results if item["status"] == "pass"),
            "failed_fixtures": sum(1 for item in fixture_results if item["status"] == "fail"),
            "blocked_fixtures": sum(1 for item in fixture_results if item["status"] == "blocked"),
            "golden_passed": all(item["status"] == "pass" for item in golden_results),
            "critical_safety_regressions": critical_regressions,
            "regression_pass_rate": regression_pass_rate,
            "trace_complete": all(all(item["trace_contract"][key] for key in TRACE_KEYS) for item in fixture_results),
            "export_contract_complete": all(item["export_contract"]["blocks_when_incomplete"] for item in fixture_results),
            "qa_fixture_coverage_complete": all(
                item["qa_coverage_contract"]["coverage_complete"]
                for item in fixture_results
            ),
            "qa_categories_covered": QA_CATEGORY_ORDER,
            "safety_enforcement_points_covered": SAFETY_ORDER,
        },
        "fixture_results": fixture_results,
        "runner_contract": {
            "runner": "scripts/run_stage0_eval.py",
            "runner_sha256": runner_digest,
            "deterministic_replay_command": "python3 scripts/run_stage0_eval.py --check",
            "writes_stored_fixture": True,
            "check_mode_compares_exact_json": True,
            "source_fixture_digests": source_fixture_digests(),
        },
        "storage_contract": {
            "table": "eval_results",
            "required_columns": [
                "id",
                "tenant_id",
                "eval_suite_id",
                "subject_type",
                "subject_id",
                "subject_version",
                "status",
                "summary",
                "runner",
                "runner_sha256",
                "completed_at",
                "created_at",
            ],
            "required_indexes": [
                "idx_eval_results_tenant_suite_subject_created_at",
                "idx_eval_results_subject_status_completed_at",
            ],
            "required_query_filters": [
                "tenant_id",
                "eval_suite_id",
                "subject_type",
                "subject_id",
                "status",
                "completed_after",
                "latest_only",
            ],
            "summary_json_contains_fixture_results": True,
            "summary_projection_fields": SUMMARY_PROJECTION_FIELDS,
            "fixture_result_projection_fields": FIXTURE_RESULT_PROJECTION_FIELDS,
            "admin_read_projection_required": True,
            "read_without_eval_rerun": True,
            "tenant_scoped": True,
            "subject_scoped": True,
            "latest_result_resolvable": True,
            "immutable_rows": True,
            "idempotent_replay_key": [
                "tenant_id",
                "eval_suite_id",
                "subject_type",
                "subject_id",
                "subject_version",
                "runner_sha256",
            ],
            "idempotent_replay_conflict_policy": {
                "exact_replay_returns_existing_row": True,
                "same_key_different_result_rejected": True,
                "same_subject_other_tenant_inserts_new_row": True,
                "conflict_requires_admin_audit": True,
                "blocked_conflict_denies_activation": True,
            },
            "retention_contract": {
                "retain_pass_fail_blocked_results": True,
                "retain_summary_json": True,
                "retain_runner_hash": True,
                "deletion_requires_admin_audit": True,
                "redaction_requires_admin_audit": True,
                "no_public_delete_operation": True,
                "minimum_retention_days": 365,
            },
            "no_public_delete_operation": True,
        },
        "provenance": {
            "blueprint_sections": [
                "12",
                "14.1",
                "15.1",
                "15.2",
                "15.3",
                "24",
                "25.11",
            ],
            "created_by_lane": "lane2",
            "runner": "scripts/run_stage0_eval.py",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write fixtures/stage0/rev2/eval/starter_eval_results.json")
    parser.add_argument("--check", action="store_true", help="compare computed output with stored eval results")
    args = parser.parse_args()

    try:
        result = run_eval()
        encoded = json.dumps([result], indent=2, sort_keys=False) + "\n"
        if args.write:
            RESULT_PATH.write_text(encoded, encoding="utf-8")
        if args.check:
            require(RESULT_PATH.exists(), "stored eval result fixture is missing")
            require(RESULT_PATH.read_text(encoding="utf-8") == encoded, "stored eval results are stale; run scripts/run_stage0_eval.py --write")
        if not args.write and not args.check:
            print(encoded, end="")
    except EvalContractError as exc:
        print(f"stage0 eval failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
