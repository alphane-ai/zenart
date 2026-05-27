#!/usr/bin/env python3
"""Validate Stage 0 Rev2 QA result category and outcome coverage."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
CONTRACT = FIXTURE_DIR / "qa_result_coverage.json"
QA_RESULTS = FIXTURE_DIR / "qa_results.json"
EVAL_RESULTS = FIXTURE_DIR / "starter_eval_results.json"
TRACE_COMPLETENESS = FIXTURE_DIR / "trace_completeness.json"
WORKFLOW_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "workflows"

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

REQUIRED_OUTCOMES = {"pass", "warn", "block"}
REQUIRED_MANIFEST_FILES = {
    "manifest.json",
    "metadata.json",
    "qa_report.json",
    "trace_provenance.json",
}
REQUIRED_TRACE_STEPS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}


class QACoverageError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise QACoverageError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise QACoverageError(message)


def fixture_result_outcome(result: dict[str, Any]) -> str:
    if result["status"] == "pass" and result["qa_export_gate"]["final_export_allowed"] is True:
        return "pass"
    if any(result["qa_export_gate"]["blocking_qa_check_ids"]):
        return "block"
    return "warn"


def qa_result_outcome(item: dict[str, Any]) -> str:
    if item["export_gate"]["blocks_final_export"] is True:
        return "block"
    if item["severity"] == "warning":
        return "warn"
    return "pass"


def validate_contract() -> None:
    contract = load_json(CONTRACT)
    qa_results = load_json(QA_RESULTS)
    eval_results = load_json(EVAL_RESULTS)
    trace_contract = load_json(TRACE_COMPLETENESS)
    workflows = {
        path.stem: load_json(path)
        for path in sorted(WORKFLOW_DIR.glob("*.json"))
    }

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "QA coverage contract must cite Rev2")
    require(contract["qa_fixture"]["path"] == "fixtures/stage0/rev2/eval/qa_results.json", "QA fixture path mismatch")
    require(len(qa_results) >= contract["qa_fixture"]["minimum_fixture_count"], "QA fixture count below coverage contract")

    check_ids = [item["check_id"] for item in qa_results]
    require(len(check_ids) == len(set(check_ids)), "QA check_id values must be unique")
    require(set(contract["required_categories"]) == set(QA_CATEGORY_ORDER), "required QA categories mismatch")
    require(set(contract["required_outcomes"]) == REQUIRED_OUTCOMES, "required QA outcomes mismatch")

    category_contracts = {item["check_category"]: item for item in contract["category_contracts"]}
    require(set(category_contracts) == set(QA_CATEGORY_ORDER), "category coverage contract must cover every QA category")
    require(len(category_contracts) == len(contract["category_contracts"]), "duplicate category contract entries")

    qa_by_id = {item["check_id"]: item for item in qa_results}
    categories_seen = {item["check_category"] for item in qa_results}
    require(categories_seen == set(QA_CATEGORY_ORDER), "QA result fixtures must cover every required category")
    require(len(workflows) == 4, "QA coverage must validate all four workflow acceptance fixtures")

    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    fixture_results = eval_results[0]["fixture_results"]
    eval_by_fixture = {item["fixture_id"]: item for item in fixture_results}
    eval_by_trace = {item["trace_contract"]["trace_id"]: item for item in fixture_results}
    trace_ids = {trace["trace_id"] for trace in trace_contract["traces"]}
    trace_by_id = {trace["trace_id"]: trace for trace in trace_contract["traces"]}

    for item in qa_results:
        contract_item = category_contracts[item["check_category"]]
        observed = set(item["evidence"]["observed"])
        expected = set(item["evidence"]["expected"])
        require(
            set(contract_item["required_observed_fields"]) <= observed,
            f"{item['check_id']} missing observed coverage fields",
        )
        require(
            set(contract_item["required_expected_fields"]) <= expected,
            f"{item['check_id']} missing expected coverage fields",
        )
        outcome = qa_result_outcome(item)
        require(
            outcome in contract_item["expected_outcomes"],
            f"{item['check_id']} outcome {outcome} is not allowed by its category contract",
        )
        require(item["export_gate"]["override_requires_audit"] is True, f"{item['check_id']} override must require audit")
        if outcome == "block":
            require(item["severity"] == "blocking", f"{item['check_id']} blocking outcome must use blocking severity")
            require(item["export_gate"]["blocks_final_export"] is True, f"{item['check_id']} must block final export")
        if outcome == "warn":
            require(item["severity"] == "warning", f"{item['check_id']} warning outcome must use warning severity")
            require(item["export_gate"]["blocks_final_export"] is False, f"{item['check_id']} warning must not block export")
        fixture_id = item["evidence"]["fixture_id"]
        trace_id = item["evidence"]["trace_id"]
        require(fixture_id in eval_by_fixture, f"{item['check_id']} references unknown eval fixture")
        require(trace_id in eval_by_trace, f"{item['check_id']} references unknown eval trace")
        require(trace_id in trace_ids, f"{item['check_id']} trace missing from trace completeness fixture")
        require(eval_by_fixture[fixture_id]["trace_contract"]["trace_id"] == trace_id, f"{item['check_id']} trace mismatch")

    summary_categories = set(eval_results[0]["summary"]["qa_categories_covered"])
    require(summary_categories == set(contract["required_categories"]), "eval result QA summary categories must match coverage contract")

    workflow_contracts = {item["workflow_id"]: item for item in contract["workflow_required_coverage"]}
    require(set(workflow_contracts) == set(workflows), "workflow QA coverage contract must cover every workflow fixture")
    require(len(workflow_contracts) == len(contract["workflow_required_coverage"]), "duplicate workflow QA coverage entries")
    qa_by_workflow: dict[str, list[dict[str, Any]]] = {}
    for item in qa_results:
        qa_by_workflow.setdefault(item["workflow"], []).append(item)
    for workflow_id, workflow in workflows.items():
        contract_item = workflow_contracts[workflow_id]
        required = set(workflow["required_qa_checks"])
        covered_items = qa_by_workflow.get(workflow_id, [])
        covered = {item["check_category"] for item in covered_items}
        source_fixtures = {item["evidence"]["fixture_id"] for item in covered_items}
        contract_sources = set(contract_item["source_fixture_ids"])
        require(set(contract_item["required_qa_checks"]) == required, f"{workflow_id} required QA checks mismatch")
        require(set(contract_item["covered_qa_checks"]) == required, f"{workflow_id} covered QA checks must equal required checks")
        require(required <= covered, f"{workflow_id} missing QA result coverage for {sorted(required - covered)}")
        require(contract_sources, f"{workflow_id} must cite QA source fixtures")
        require(contract_sources <= source_fixtures, f"{workflow_id} cites source fixtures without QA results")
        require(contract_item["coverage_complete"] is True, f"{workflow_id} workflow QA coverage must be complete")

    validate_vertical_acceptance_links(
        contract,
        qa_by_id,
        eval_by_fixture,
        workflows,
        workflow_contracts,
    )

    outcomes_seen = {fixture_result_outcome(item) for item in fixture_results}
    outcomes_seen.update(qa_result_outcome(item) for item in qa_results)
    require(REQUIRED_OUTCOMES <= outcomes_seen, f"QA coverage missing outcomes: {sorted(REQUIRED_OUTCOMES - outcomes_seen)}")

    examples = contract["outcome_examples"]
    example_outcomes = {item["outcome"] for item in examples}
    require(example_outcomes == REQUIRED_OUTCOMES, "outcome examples must cover pass, warn, and block exactly")
    for example in examples:
        validate_outcome_example(
            example,
            qa_by_id,
            eval_by_fixture,
            eval_by_trace,
            trace_by_id,
        )

    category_examples = contract["category_outcome_examples"]
    seen_category_outcomes: dict[str, set[str]] = {category: set() for category in QA_CATEGORY_ORDER}
    seen_example_keys: set[tuple[str, str, tuple[str, ...]]] = set()
    for example in category_examples:
        category = example["check_category"]
        key = (category, example["outcome"], tuple(example["check_ids"]))
        require(key not in seen_example_keys, f"duplicate category outcome example {key}")
        seen_example_keys.add(key)
        validate_outcome_example(
            example,
            qa_by_id,
            eval_by_fixture,
            eval_by_trace,
            trace_by_id,
            expected_category=category,
        )
        seen_category_outcomes[category].add(example["outcome"])

    for category, contract_item in category_contracts.items():
        require(
            set(contract_item["expected_outcomes"]) <= seen_category_outcomes[category],
            f"{category} missing category outcome examples: {sorted(set(contract_item['expected_outcomes']) - seen_category_outcomes[category])}",
        )
    require(
        set(seen_category_outcomes) == set(QA_CATEGORY_ORDER),
        "category outcome examples must cover every QA category",
    )
    require(
        REQUIRED_OUTCOMES <= set().union(*seen_category_outcomes.values()),
        "category outcome examples must cover pass, warn, and block",
    )

    validate_coverage_evidence_links(
        contract,
        qa_by_id,
        eval_by_fixture,
        trace_by_id,
        workflows,
    )

    policy = contract["export_gate_policy"]
    require(policy["blocking_severity_blocks_final_export"] is True, "blocking export policy must be explicit")
    require(policy["warning_severity_does_not_block_final_export"] is True, "warning export policy must be explicit")
    require(policy["admin_override_requires_audit"] is True, "override audit policy must be explicit")


def validate_vertical_acceptance_links(
    contract: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    eval_by_fixture: dict[str, dict[str, Any]],
    workflows: dict[str, dict[str, Any]],
    workflow_contracts: dict[str, dict[str, Any]],
) -> None:
    links = {item["workflow_id"]: item for item in contract["vertical_acceptance_links"]}
    require(set(links) == set(workflows), "vertical acceptance links must cover every workflow fixture")
    require(len(links) == len(contract["vertical_acceptance_links"]), "duplicate vertical acceptance link entries")

    for workflow_id, link in links.items():
        workflow = workflows[workflow_id]
        workflow_contract = workflow_contracts[workflow_id]
        expected_acceptance_fixture = f"fixtures/stage0/rev2/workflows/{workflow_id}.json"
        required_qa_checks = set(workflow["required_qa_checks"])
        source_fixture_ids = set(workflow_contract["source_fixture_ids"])
        eval_fixture_ids = set(link["eval_fixture_ids"])
        qa_check_ids = set(link["qa_check_ids"])
        export_required_files = workflow["export_targets"][0]["required_files"]
        required_asset_files = [
            f"assets/{asset['file_name']}"
            for asset in workflow["required_generated_assets"]
        ]

        require(link["acceptance_fixture"] == expected_acceptance_fixture, f"{workflow_id} acceptance fixture link mismatch")
        require((ROOT / link["acceptance_fixture"]).exists(), f"{workflow_id} acceptance fixture link missing on disk")
        require(
            link["golden_fixture_id"] == workflow["golden_fixture"]["fixture_id"],
            f"{workflow_id} golden fixture link mismatch",
        )
        require(link["golden_fixture_id"] in eval_fixture_ids, f"{workflow_id} golden fixture must be part of linked eval fixtures")
        require(eval_fixture_ids == source_fixture_ids, f"{workflow_id} vertical eval fixture links must match workflow coverage sources")
        require(set(link["required_qa_checks"]) == required_qa_checks, f"{workflow_id} vertical required QA checks mismatch")
        require(set(link["export_required_files"]) == set(export_required_files), f"{workflow_id} export required files mismatch")
        require(set(link["required_manifest_files"]) == REQUIRED_MANIFEST_FILES, f"{workflow_id} manifest file contract mismatch")
        require(set(link["required_manifest_files"]) <= set(export_required_files), f"{workflow_id} export files missing manifest bundle")
        require(set(link["required_asset_files"]) == set(required_asset_files), f"{workflow_id} required asset files mismatch")
        require(set(link["required_asset_files"]) <= set(export_required_files), f"{workflow_id} export files missing required assets")
        require(link["coverage_complete"] is True, f"{workflow_id} vertical QA acceptance link must be complete")

        golden_export_files = set(workflow["golden_fixture"]["expected_export_files"])
        require(
            golden_export_files <= set(export_required_files),
            f"{workflow_id} golden fixture expected export files must be a subset of export target files",
        )
        require(
            REQUIRED_MANIFEST_FILES <= golden_export_files,
            f"{workflow_id} golden fixture must include manifest, metadata, QA report, and trace provenance",
        )

        linked_categories: set[str] = set()
        linked_fixture_ids: set[str] = set()
        for check_id in qa_check_ids:
            require(check_id in qa_by_id, f"{workflow_id} vertical link references unknown QA check {check_id}")
            qa_item = qa_by_id[check_id]
            linked_categories.add(qa_item["check_category"])
            linked_fixture_ids.add(qa_item["evidence"]["fixture_id"])
            require(qa_item["workflow"] == workflow_id, f"{check_id} vertical link workflow mismatch")
            require(
                qa_item["evidence"]["fixture_id"] in eval_fixture_ids,
                f"{check_id} vertical link fixture is not in linked eval fixtures",
            )
            require(
                qa_item["check_id"] in eval_by_fixture[qa_item["evidence"]["fixture_id"]]["qa_check_ids"],
                f"{check_id} vertical link missing from eval result fixture",
            )

        require(linked_categories == required_qa_checks, f"{workflow_id} vertical link QA categories mismatch")
        require(
            source_fixture_ids <= linked_fixture_ids,
            f"{workflow_id} vertical link must include QA checks from every source fixture",
        )
        require(
            all(eval_by_fixture[fixture_id]["workflow"] == workflow_id for fixture_id in eval_fixture_ids),
            f"{workflow_id} linked eval fixtures must belong to the workflow",
        )


def validate_coverage_evidence_links(
    contract: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    eval_by_fixture: dict[str, dict[str, Any]],
    trace_by_id: dict[str, dict[str, Any]],
    workflows: dict[str, dict[str, Any]],
) -> None:
    links = contract["coverage_evidence_links"]
    link_by_check = {item["check_id"]: item for item in links}
    require(len(link_by_check) == len(links), "coverage evidence links must not duplicate check_id")
    require(set(link_by_check) == set(qa_by_id), "coverage evidence links must cover every QA result check")
    validate_source_artifact_resolution_contract(
        contract,
        qa_by_id,
        eval_by_fixture,
        trace_by_id,
        workflows,
    )

    links_by_workflow: dict[str, list[dict[str, Any]]] = {}
    linked_categories: dict[str, set[str]] = {}
    linked_fixtures: dict[str, set[str]] = {}
    for link in links:
        check_id = link["check_id"]
        qa_item = qa_by_id[check_id]
        fixture_id = link["eval_fixture_id"]
        trace_id = link["trace_id"]

        require(link["qa_result_path"] == "fixtures/stage0/rev2/eval/qa_results.json", f"{check_id} QA path mismatch")
        require(
            link["eval_result_path"] == "fixtures/stage0/rev2/eval/starter_eval_results.json",
            f"{check_id} eval result path mismatch",
        )
        require(
            link["trace_contract_path"] == "fixtures/stage0/rev2/eval/trace_completeness.json",
            f"{check_id} trace contract path mismatch",
        )
        require(fixture_id in eval_by_fixture, f"{check_id} links unknown eval fixture {fixture_id}")
        require(trace_id in trace_by_id, f"{check_id} links unknown trace {trace_id}")

        result = eval_by_fixture[fixture_id]
        trace = trace_by_id[trace_id]
        expected_acceptance_fixture = f"fixtures/stage0/rev2/workflows/{qa_item['workflow']}.json"
        expected_trace_steps = set(trace["covered_steps"])

        require(link["check_category"] == qa_item["check_category"], f"{check_id} category link mismatch")
        require(link["workflow_id"] == qa_item["workflow"], f"{check_id} workflow link mismatch")
        require(link["acceptance_fixture"] == expected_acceptance_fixture, f"{check_id} acceptance fixture link mismatch")
        require((ROOT / link["acceptance_fixture"]).exists(), f"{check_id} linked acceptance fixture missing")
        require(link["eval_fixture_id"] == qa_item["evidence"]["fixture_id"], f"{check_id} eval fixture link mismatch")
        require(link["trace_id"] == qa_item["evidence"]["trace_id"], f"{check_id} trace link mismatch")
        require(result["workflow"] == link["workflow_id"], f"{check_id} eval result workflow mismatch")
        require(trace["workflow"] == link["workflow_id"], f"{check_id} trace workflow mismatch")
        require(trace["fixture_id"] == fixture_id, f"{check_id} trace fixture mismatch")
        require(result["trace_contract"]["trace_id"] == trace_id, f"{check_id} eval trace mismatch")
        require(check_id in result["qa_check_ids"], f"{check_id} missing from eval result qa_check_ids")
        require(qa_result_outcome(qa_item) == link["outcome"], f"{check_id} outcome link mismatch")
        require(
            result["observed_safety_action"] == link["safety_action"],
            f"{check_id} safety action link mismatch",
        )
        require(
            result["qa_export_gate"]["final_export_allowed"] is link["final_export_allowed"],
            f"{check_id} final export link mismatch",
        )
        require(
            qa_item["export_gate"]["blocks_final_export"] is link["blocks_final_export"],
            f"{check_id} blocking export link mismatch",
        )
        require(
            result["qa_export_gate"]["export_artifacts_complete"] is link["export_artifacts_complete"],
            f"{check_id} export artifact completeness link mismatch",
        )
        require(link["vertical_acceptance_required"] is True, f"{check_id} must require vertical acceptance")
        require(expected_trace_steps == REQUIRED_TRACE_STEPS, f"{check_id} linked trace does not cover required steps")
        require(set(link["trace_steps"]) == REQUIRED_TRACE_STEPS, f"{check_id} trace steps link mismatch")
        require(link["source_artifacts"] == qa_item["evidence"]["source_artifacts"], f"{check_id} source artifact link mismatch")
        require(link["source_artifacts_present"] is True, f"{check_id} source artifacts must be present")
        require(bool(link["source_artifacts"]), f"{check_id} source artifact link must not be empty")
        validate_source_artifacts_resolve(
            check_id,
            link["source_artifacts"],
            qa_item,
            result,
            trace,
            workflows[link["workflow_id"]],
        )
        require(link["coverage_complete"] is True, f"{check_id} coverage evidence link must be complete")
        require(
            link["check_category"] in workflows[link["workflow_id"]]["required_qa_checks"],
            f"{check_id} linked category is not required by its workflow acceptance fixture",
        )
        if link["blocks_final_export"]:
            require(
                check_id in result["qa_export_gate"]["blocking_qa_check_ids"],
                f"{check_id} blocking evidence link missing eval export gate check",
            )
            require(
                link["check_category"] in result["qa_export_gate"]["blocking_qa_categories"],
                f"{check_id} blocking evidence link missing eval export gate category",
            )
        else:
            require(
                check_id not in result["qa_export_gate"]["blocking_qa_check_ids"],
                f"{check_id} nonblocking evidence link appears in eval blocking checks",
            )

        links_by_workflow.setdefault(link["workflow_id"], []).append(link)
        linked_categories.setdefault(link["workflow_id"], set()).add(link["check_category"])
        linked_fixtures.setdefault(link["workflow_id"], set()).add(fixture_id)

    workflow_contracts = {item["workflow_id"]: item for item in contract["workflow_required_coverage"]}
    vertical_links = {item["workflow_id"]: item for item in contract["vertical_acceptance_links"]}
    require(set(links_by_workflow) == set(workflows), "coverage evidence links must cover every workflow")
    for workflow_id, workflow in workflows.items():
        required = set(workflow["required_qa_checks"])
        require(
            linked_categories.get(workflow_id, set()) == required,
            f"{workflow_id} evidence links must cover required QA categories",
        )
        require(
            linked_fixtures.get(workflow_id, set()) == set(workflow_contracts[workflow_id]["source_fixture_ids"]),
            f"{workflow_id} evidence links must cover workflow source fixtures",
        )
        require(
            {link["check_id"] for link in links_by_workflow[workflow_id]} == set(vertical_links[workflow_id]["qa_check_ids"]),
            f"{workflow_id} evidence links must match vertical acceptance QA checks",
        )


def validate_source_artifact_resolution_contract(
    contract: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    eval_by_fixture: dict[str, dict[str, Any]],
    trace_by_id: dict[str, dict[str, Any]],
    workflows: dict[str, dict[str, Any]],
) -> None:
    resolution = contract["source_artifact_resolution"]
    for flag in [
        "requires_qa_evidence_match",
        "requires_workflow_acceptance_match",
        "requires_export_bundle_match",
        "requires_generated_asset_match",
        "requires_trace_export_links",
        "requires_eval_gate_match",
    ]:
        require(resolution[flag] is True, f"source artifact resolution must set {flag}")

    required_resolvers = {
        "workflow_acceptance_fixture",
        "workflow_export_target",
        "workflow_generated_asset",
        "eval_qa_export_gate",
        "trace_export_reference",
        "trace_artifact_link",
        "qa_observed_field",
        "qa_expected_field",
        "qa_fixture_source_material",
        "safety_decision_trace_event",
    }
    require(
        set(resolution["logical_artifact_resolvers"]) == required_resolvers,
        "source artifact resolution must declare every logical resolver",
    )

    for check_id, qa_item in qa_by_id.items():
        fixture_id = qa_item["evidence"]["fixture_id"]
        trace_id = qa_item["evidence"]["trace_id"]
        require(fixture_id in eval_by_fixture, f"{check_id} source resolution references unknown eval fixture")
        require(trace_id in trace_by_id, f"{check_id} source resolution references unknown trace")
        require(qa_item["workflow"] in workflows, f"{check_id} source resolution references unknown workflow")
        validate_source_artifacts_resolve(
            check_id,
            qa_item["evidence"]["source_artifacts"],
            qa_item,
            eval_by_fixture[fixture_id],
            trace_by_id[trace_id],
            workflows[qa_item["workflow"]],
        )


def validate_source_artifacts_resolve(
    check_id: str,
    source_artifacts: list[str],
    qa_item: dict[str, Any],
    eval_result: dict[str, Any],
    trace: dict[str, Any],
    workflow: dict[str, Any],
) -> None:
    workflow_id = qa_item["workflow"]
    export_files = {
        file_name
        for target in workflow["export_targets"]
        for file_name in target["required_files"]
    }
    generated_assets = {
        f"assets/{asset['file_name']}"
        for asset in workflow["required_generated_assets"]
    }
    observed_fields = set(qa_item["evidence"]["observed"])
    expected_fields = set(qa_item["evidence"]["expected"])
    trace_steps = {event["step_name"]: event for event in trace["step_events"]}

    require(trace["fixture_id"] == eval_result["fixture_id"], f"{check_id} source resolution trace fixture mismatch")
    require(trace["workflow"] == workflow_id, f"{check_id} source resolution trace workflow mismatch")
    require(eval_result["workflow"] == workflow_id, f"{check_id} source resolution eval workflow mismatch")

    for artifact in source_artifacts:
        require(
            source_artifact_resolves(
                artifact,
                workflow_id,
                export_files,
                generated_assets,
                observed_fields,
                expected_fields,
                qa_item,
                eval_result,
                trace,
                trace_steps,
            ),
            f"{check_id} source artifact {artifact} does not resolve through workflow/eval/trace/QA evidence",
        )


def source_artifact_resolves(
    artifact: str,
    workflow_id: str,
    export_files: set[str],
    generated_assets: set[str],
    observed_fields: set[str],
    expected_fields: set[str],
    qa_item: dict[str, Any],
    eval_result: dict[str, Any],
    trace: dict[str, Any],
    trace_steps: dict[str, dict[str, Any]],
) -> bool:
    if artifact == f"workflow_acceptance.{workflow_id}.json":
        return True
    if artifact in export_files:
        return True
    if artifact in generated_assets:
        return True
    if artifact == "export.zip":
        return "export_completeness" in eval_result["qa_coverage_contract"]["observed_qa_categories"]
    if artifact == "manifest.json":
        return (
            eval_result["export_contract"]["manifest"] is True
            and trace["export_references"]["manifest"] is True
            and trace["artifact_links"]["manifest_linked"] is True
        )
    if artifact == "metadata.json":
        return eval_result["export_contract"]["metadata"] is True
    if artifact == "qa_report.json":
        return (
            eval_result["export_contract"]["qa_report"] is True
            and trace["export_references"]["qa_report"] is True
            and trace["artifact_links"]["qa_report_linked"] is True
        )
    if artifact == "trace_provenance.json":
        return (
            eval_result["export_contract"]["trace_provenance"] is True
            and trace["export_references"]["trace_provenance"] is True
            and trace["artifact_links"]["trace_provenance_linked"] is True
        )
    if artifact == "safety_decision.json":
        return all(
            step in trace_steps
            and trace_steps[step]["safety_decision_ref"]["decision_id"]
            and trace_steps[step]["safety_decision_ref"]["table"] == "safety_decisions"
            for step in REQUIRED_TRACE_STEPS
        )
    if artifact == "object_metadata.checksum":
        return "checksum_sha256" in observed_fields and "checksum_sha256" in expected_fields
    if artifact == "decoder.probe.json":
        return "decoder_status" in observed_fields and "decoder_status" in expected_fields
    if artifact == "candidate_asset.metadata":
        return bool({"width_px", "height_px", "export_target"} & observed_fields)
    if artifact == "candidate_asset.layout.json":
        return bool({"cta_bottom_margin_px", "safe_area_bottom_min_px", "overlaps_platform_ui"} & observed_fields)
    if artifact == "candidate_asset.ocr.json":
        return bool({"ocr_confidence", "claim_text", "price", "date", "phone", "address"} & observed_fields)
    if artifact == "candidate_asset.preview.png":
        return bool(generated_assets) and "qa" in trace_steps and bool(trace["artifact_links"]["asset_ids"])
    if artifact.endswith("_candidate_set.json"):
        return bool({"candidate_pair", "strategic_options", "taxonomy_coverage"} & observed_fields)
    if artifact == "brief.inputs":
        return "brief" in trace_steps and bool(observed_fields & expected_fields)
    if artifact.startswith("fixtures/assets/"):
        if any(value == artifact for value in qa_evidence_string_values(qa_item)):
            return True
        if qa_item["check_category"] == "file_integrity":
            return artifact.endswith(".png") and "checksum_sha256" in observed_fields and "decoder_status" in observed_fields
        if qa_item["check_category"] == "product_logo_preservation":
            return artifact.endswith((".svg", ".png")) and {
                "logo_similarity",
                "product_shape_similarity",
                "unauthorized_color_change",
            } <= observed_fields
    return False


def qa_evidence_string_values(qa_item: dict[str, Any]) -> set[str]:
    values: set[str] = set()
    stack: list[Any] = [
        qa_item["evidence"]["observed"],
        qa_item["evidence"]["expected"],
        qa_item["admin_reason"],
    ]
    while stack:
        value = stack.pop()
        if isinstance(value, str):
            values.add(value)
        elif isinstance(value, dict):
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return values


def validate_outcome_example(
    example: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    eval_by_fixture: dict[str, dict[str, Any]],
    eval_by_trace: dict[str, dict[str, Any]],
    trace_by_id: dict[str, dict[str, Any]],
    expected_category: str | None = None,
) -> None:
    fixture_id = example["fixture_id"]
    trace_id = example["trace_id"]
    require(fixture_id in eval_by_fixture, f"outcome example references unknown fixture {fixture_id}")
    require(trace_id in eval_by_trace, f"outcome example references unknown eval trace {trace_id}")
    require(trace_id in trace_by_id, f"outcome example references unknown trace completeness record {trace_id}")

    result = eval_by_fixture[fixture_id]
    trace = trace_by_id[trace_id]
    require(result["workflow"] == example["workflow"], f"{fixture_id} outcome example workflow mismatch")
    require(result["trace_contract"]["trace_id"] == trace_id, f"{fixture_id} outcome example trace mismatch")
    require(trace["fixture_id"] == fixture_id, f"{trace_id} outcome example trace fixture mismatch")
    require(trace["workflow"] == example["workflow"], f"{trace_id} outcome example trace workflow mismatch")

    if example["source"] == "eval_result_fixture":
        require(fixture_result_outcome(result) == example["outcome"], f"{fixture_id} eval outcome example mismatch")
    else:
        require(example["check_ids"], f"{fixture_id} QA outcome example must cite checks")
        for check_id in example["check_ids"]:
            require(check_id in qa_by_id, f"outcome example references unknown check {check_id}")
            qa_item = qa_by_id[check_id]
            require(qa_item["evidence"]["fixture_id"] == fixture_id, f"{check_id} example fixture mismatch")
            require(qa_item["evidence"]["trace_id"] == trace_id, f"{check_id} example trace mismatch")
            require(qa_item["workflow"] == example["workflow"], f"{check_id} example workflow mismatch")
            require(qa_result_outcome(qa_item) == example["outcome"], f"{check_id} QA outcome example mismatch")
            require(qa_item["evidence"]["source_artifacts"], f"{check_id} QA outcome example must cite source artifacts")
            if expected_category is not None:
                require(
                    qa_item["check_category"] == expected_category,
                    f"{check_id} category outcome example must be {expected_category}",
                )
                if example["expected_blocks_final_export"]:
                    require(
                        check_id in result["qa_export_gate"]["blocking_qa_check_ids"],
                        f"{check_id} blocking example missing from eval export gate",
                    )
                    require(
                        expected_category in result["qa_export_gate"]["blocking_qa_categories"],
                        f"{expected_category} blocking category missing from eval export gate",
                    )
                else:
                    require(
                        check_id not in result["qa_export_gate"]["blocking_qa_check_ids"],
                        f"{check_id} nonblocking example must not appear in eval blocking checks",
                    )

    require(
        result["qa_export_gate"]["final_export_allowed"] is example["final_export_allowed"],
        f"{fixture_id} final export allowance mismatch",
    )
    if "expected_export_artifacts_complete" in example:
        require(
            result["qa_export_gate"]["export_artifacts_complete"] is example["expected_export_artifacts_complete"],
            f"{fixture_id} export artifact completeness mismatch",
        )


def main() -> int:
    try:
        validate_contract()
    except QACoverageError as exc:
        print(f"QA result coverage validation failed: {exc}", file=sys.stderr)
        return 1
    print("QA result coverage validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
