#!/usr/bin/env python3
"""Validate the Stage 0 Rev2 QA source-artifact resolution contract.

This runner intentionally does not delegate to the broad QA coverage validator.
It proves that every QA result's declared source artifacts resolve through the
workflow acceptance fixture, eval export gate, trace export links, and QA
observed/expected evidence.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
EVAL_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
WORKFLOW_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "workflows"

CONTRACT = EVAL_DIR / "qa_result_coverage.json"
QA_RESULTS = EVAL_DIR / "qa_results.json"
EVAL_RESULTS = EVAL_DIR / "starter_eval_results.json"
TRACE_COMPLETENESS = EVAL_DIR / "trace_completeness.json"

REQUIRED_TRACE_STEPS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

REQUIRED_RESOLVERS = {
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

REQUIRED_REPORT_FIELDS = {
    "check_id",
    "artifact",
    "resolver",
    "resolved",
    "evidence_ref",
}


class SourceArtifactError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SourceArtifactError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SourceArtifactError(message)


def qa_result_outcome(item: dict[str, Any]) -> str:
    if item["export_gate"]["blocks_final_export"] is True:
        return "block"
    if item["severity"] == "warning":
        return "warn"
    return "pass"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--json",
        action="store_true",
        help="print the per-check artifact resolution report as JSON",
    )
    args = parser.parse_args()

    try:
        report = validate_contract()
    except SourceArtifactError as exc:
        print(f"QA source artifact contract failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(
            "QA source artifact contract passed: "
            f"{report['summary']['checks']} checks, "
            f"{report['summary']['artifacts']} artifacts, "
            f"{len(report['summary']['resolvers_covered'])} resolvers"
        )
    return 0


def validate_contract() -> dict[str, Any]:
    contract = load_json(CONTRACT)
    qa_results = load_json(QA_RESULTS)
    eval_results = load_json(EVAL_RESULTS)
    trace_contract = load_json(TRACE_COMPLETENESS)
    workflows = {
        path.stem: load_json(path)
        for path in sorted(WORKFLOW_DIR.glob("*.json"))
    }

    resolution_contract = contract["source_artifact_resolution"]
    require(resolution_contract["requires_dedicated_runner"] is True, "dedicated runner flag must be true")
    require(
        resolution_contract["dedicated_runner"] == "scripts/run_qa_source_artifact_contract.py",
        "dedicated runner path mismatch",
    )
    require(
        resolution_contract["requires_per_check_resolution_report"] is True,
        "per-check resolution report flag must be true",
    )
    require(
        set(resolution_contract["required_artifact_resolution_fields"]) == REQUIRED_REPORT_FIELDS,
        "required resolution report fields mismatch",
    )
    require(
        set(resolution_contract["required_resolver_coverage"]) == REQUIRED_RESOLVERS,
        "required resolver coverage mismatch",
    )
    require(
        set(resolution_contract["logical_artifact_resolvers"]) == REQUIRED_RESOLVERS,
        "logical resolver list mismatch",
    )

    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    eval_by_fixture = {item["fixture_id"]: item for item in eval_results[0]["fixture_results"]}
    trace_by_id = {trace["trace_id"]: trace for trace in trace_contract["traces"]}
    qa_by_id = {item["check_id"]: item for item in qa_results}
    coverage_links = {item["check_id"]: item for item in contract["coverage_evidence_links"]}

    require(len(qa_by_id) == len(qa_results), "QA result check_id values must be unique")
    require(set(coverage_links) == set(qa_by_id), "coverage evidence links must cover every QA result")
    require(set(workflows) == {item["workflow_id"] for item in contract["workflow_required_coverage"]}, "workflow coverage mismatch")

    artifact_results: list[dict[str, Any]] = []
    resolvers_covered: set[str] = set()
    checks_seen: set[str] = set()

    for check_id, qa_item in sorted(qa_by_id.items()):
        link = coverage_links[check_id]
        fixture_id = qa_item["evidence"]["fixture_id"]
        trace_id = qa_item["evidence"]["trace_id"]
        workflow_id = qa_item["workflow"]

        require(link["source_artifacts"] == qa_item["evidence"]["source_artifacts"], f"{check_id} source artifact link mismatch")
        require(link["source_artifacts_present"] is True, f"{check_id} source artifacts must be present")
        require(link["coverage_complete"] is True, f"{check_id} coverage link must be complete")
        require(link["eval_fixture_id"] == fixture_id, f"{check_id} eval fixture link mismatch")
        require(link["trace_id"] == trace_id, f"{check_id} trace link mismatch")
        require(link["workflow_id"] == workflow_id, f"{check_id} workflow link mismatch")
        require(link["check_category"] == qa_item["check_category"], f"{check_id} category link mismatch")
        require(link["outcome"] == qa_result_outcome(qa_item), f"{check_id} outcome link mismatch")
        require(set(link["trace_steps"]) == REQUIRED_TRACE_STEPS, f"{check_id} trace steps mismatch")
        require(fixture_id in eval_by_fixture, f"{check_id} references unknown eval fixture {fixture_id}")
        require(trace_id in trace_by_id, f"{check_id} references unknown trace {trace_id}")
        require(workflow_id in workflows, f"{check_id} references unknown workflow {workflow_id}")

        eval_result = eval_by_fixture[fixture_id]
        trace = trace_by_id[trace_id]
        workflow = workflows[workflow_id]
        validate_check_link(check_id, qa_item, link, eval_result, trace, workflow)

        source_artifacts = qa_item["evidence"]["source_artifacts"]
        require(source_artifacts, f"{check_id} must cite at least one source artifact")
        for artifact in source_artifacts:
            artifact_result = resolve_artifact(check_id, artifact, qa_item, eval_result, trace, workflow)
            require(artifact_result["resolved"] is True, f"{check_id} source artifact {artifact} did not resolve")
            require(REQUIRED_REPORT_FIELDS <= set(artifact_result), f"{check_id} source artifact report is incomplete")
            artifact_results.append(artifact_result)
            resolvers_covered.add(artifact_result["resolver"])
        checks_seen.add(check_id)

    require(resolvers_covered == REQUIRED_RESOLVERS, f"resolver coverage mismatch: {sorted(REQUIRED_RESOLVERS - resolvers_covered)}")
    require(checks_seen == set(qa_by_id), "not every QA check produced source artifact resolution")

    return {
        "schema_version": "stage0.rev2",
        "contract_id": contract["contract_id"],
        "runner": "scripts/run_qa_source_artifact_contract.py",
        "summary": {
            "checks": len(checks_seen),
            "artifacts": len(artifact_results),
            "resolvers_covered": sorted(resolvers_covered),
        },
        "artifact_results": artifact_results,
    }


def validate_check_link(
    check_id: str,
    qa_item: dict[str, Any],
    link: dict[str, Any],
    eval_result: dict[str, Any],
    trace: dict[str, Any],
    workflow: dict[str, Any],
) -> None:
    workflow_id = qa_item["workflow"]
    expected_acceptance_fixture = f"fixtures/stage0/rev2/workflows/{workflow_id}.json"

    require(link["acceptance_fixture"] == expected_acceptance_fixture, f"{check_id} acceptance fixture mismatch")
    require((ROOT / expected_acceptance_fixture).exists(), f"{check_id} acceptance fixture missing")
    require(eval_result["workflow"] == workflow_id, f"{check_id} eval workflow mismatch")
    require(trace["workflow"] == workflow_id, f"{check_id} trace workflow mismatch")
    require(trace["fixture_id"] == eval_result["fixture_id"], f"{check_id} trace fixture mismatch")
    require(eval_result["trace_contract"]["trace_id"] == trace["trace_id"], f"{check_id} eval trace mismatch")
    require(check_id in eval_result["qa_check_ids"], f"{check_id} missing from eval result qa_check_ids")
    require(
        qa_item["check_category"] in workflow["required_qa_checks"],
        f"{check_id} category is not required by workflow acceptance fixture",
    )
    require(
        eval_result["observed_safety_action"] == link["safety_action"],
        f"{check_id} safety action link mismatch",
    )
    require(
        eval_result["qa_export_gate"]["final_export_allowed"] is link["final_export_allowed"],
        f"{check_id} final export gate mismatch",
    )
    require(
        eval_result["qa_export_gate"]["export_artifacts_complete"] is link["export_artifacts_complete"],
        f"{check_id} export artifact completeness mismatch",
    )
    require(
        qa_item["export_gate"]["blocks_final_export"] is link["blocks_final_export"],
        f"{check_id} blocking export link mismatch",
    )

    if link["blocks_final_export"]:
        require(check_id in eval_result["qa_export_gate"]["blocking_qa_check_ids"], f"{check_id} missing from blocking checks")
        require(
            qa_item["check_category"] in eval_result["qa_export_gate"]["blocking_qa_categories"],
            f"{check_id} missing from blocking categories",
        )
    else:
        require(check_id not in eval_result["qa_export_gate"]["blocking_qa_check_ids"], f"{check_id} should not block")


def resolve_artifact(
    check_id: str,
    artifact: str,
    qa_item: dict[str, Any],
    eval_result: dict[str, Any],
    trace: dict[str, Any],
    workflow: dict[str, Any],
) -> dict[str, Any]:
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

    require(set(trace["covered_steps"]) == REQUIRED_TRACE_STEPS, f"{check_id} trace does not cover every pipeline step")

    result = resolution_result(check_id, artifact, "", False, "")

    if artifact == f"workflow_acceptance.{workflow_id}.json":
        result = resolution_result(check_id, artifact, "workflow_acceptance_fixture", True, f"fixtures/stage0/rev2/workflows/{workflow_id}.json")
    elif artifact in {"manifest.json", "metadata.json", "qa_report.json", "trace_provenance.json"}:
        if (
            qa_item["check_category"] == "export_completeness"
            and eval_result["export_contract"][artifact.removesuffix(".json")] is False
        ):
            result = resolution_result(
                check_id,
                artifact,
                "workflow_export_target",
                artifact in export_files,
                f"workflow.export_targets.required_files.{artifact}",
            )
        else:
            result = resolve_export_contract_artifact(check_id, artifact, eval_result, trace)
    elif artifact in generated_assets:
        result = resolution_result(check_id, artifact, "workflow_generated_asset", True, f"workflow.required_generated_assets.{artifact}")
    elif artifact in export_files:
        result = resolution_result(check_id, artifact, "workflow_export_target", True, f"workflow.export_targets.required_files.{artifact}")
    elif artifact == "export.zip":
        result = resolution_result(
            check_id,
            artifact,
            "eval_qa_export_gate",
            "export_completeness" in eval_result["qa_coverage_contract"]["observed_qa_categories"],
            "eval_result.qa_coverage_contract.observed_qa_categories.export_completeness",
        )
    elif artifact == "safety_decision.json":
        resolved = all(
            step in trace_steps
            and trace_steps[step]["safety_decision_ref"]["decision_id"]
            and trace_steps[step]["safety_decision_ref"]["table"] == "safety_decisions"
            for step in REQUIRED_TRACE_STEPS
        )
        result = resolution_result(check_id, artifact, "safety_decision_trace_event", resolved, "trace.step_events.safety_decision_ref")
    elif artifact == "object_metadata.checksum":
        result = observed_expected_result(
            check_id,
            artifact,
            "qa_observed_field",
            {"checksum_sha256"},
            observed_fields,
            "qa.evidence.observed.checksum_sha256",
        )
        require("checksum_sha256" in expected_fields, f"{check_id} object metadata checksum missing expected field")
    elif artifact == "decoder.probe.json":
        result = observed_expected_result(
            check_id,
            artifact,
            "qa_expected_field",
            {"decoder_status"},
            expected_fields,
            "qa.evidence.expected.decoder_status",
        )
        require("decoder_status" in observed_fields, f"{check_id} decoder probe missing observed field")
    elif artifact == "candidate_asset.metadata":
        result = observed_expected_result(
            check_id,
            artifact,
            "qa_observed_field",
            {"width_px", "height_px", "export_target"},
            observed_fields,
            "qa.evidence.observed.asset_metadata",
        )
    elif artifact == "candidate_asset.layout.json":
        result = observed_expected_result(
            check_id,
            artifact,
            "qa_observed_field",
            {"cta_bottom_margin_px", "safe_area_bottom_min_px", "overlaps_platform_ui"},
            observed_fields,
            "qa.evidence.observed.layout",
        )
    elif artifact == "candidate_asset.ocr.json":
        result = observed_expected_result(
            check_id,
            artifact,
            "qa_observed_field",
            {"ocr_confidence", "claim_text", "price", "date", "phone", "address"},
            observed_fields,
            "qa.evidence.observed.ocr",
            require_any=True,
        )
    elif artifact == "candidate_asset.preview.png":
        resolved = "qa" in trace_steps and bool(trace["artifact_links"]["asset_ids"]) and bool(generated_assets)
        result = resolution_result(check_id, artifact, "trace_artifact_link", resolved, "trace.artifact_links.asset_ids")
    elif artifact.endswith("_candidate_set.json"):
        result = observed_expected_result(
            check_id,
            artifact,
            "qa_observed_field",
            {"candidate_pair", "strategic_options", "taxonomy_coverage"},
            observed_fields,
            "qa.evidence.observed.candidate_set",
            require_any=True,
        )
    elif artifact == "brief.inputs":
        resolved = "brief" in trace_steps and bool(observed_fields & expected_fields)
        result = resolution_result(check_id, artifact, "qa_expected_field", resolved, "qa.evidence.expected.brief_fields")
    elif artifact.startswith("fixtures/assets/"):
        result = resolve_fixture_source_material(check_id, artifact, qa_item, observed_fields)

    return result


def resolve_export_contract_artifact(
    check_id: str,
    artifact: str,
    eval_result: dict[str, Any],
    trace: dict[str, Any],
) -> dict[str, Any]:
    export_key = artifact.removesuffix(".json")
    if artifact == "metadata.json":
        return resolution_result(
            check_id,
            artifact,
            "workflow_export_target",
            eval_result["export_contract"]["metadata"] is True,
            "eval_result.export_contract.metadata",
        )

    trace_reference_key = "manifest" if artifact == "manifest.json" else export_key
    trace_link_key = {
        "manifest.json": "manifest_linked",
        "qa_report.json": "qa_report_linked",
        "trace_provenance.json": "trace_provenance_linked",
    }.get(artifact)
    resolved = (
        eval_result["export_contract"][trace_reference_key] is True
        and trace["export_references"][trace_reference_key] is True
        and trace["artifact_links"][trace_link_key] is True
    )
    resolver = "trace_export_reference" if artifact in {"manifest.json", "trace_provenance.json"} else "trace_artifact_link"
    return resolution_result(
        check_id,
        artifact,
        resolver,
        resolved,
        f"trace.export_references.{trace_reference_key}+trace.artifact_links.{trace_link_key}",
    )


def resolve_fixture_source_material(
    check_id: str,
    artifact: str,
    qa_item: dict[str, Any],
    observed_fields: set[str],
) -> dict[str, Any]:
    evidence_values = qa_evidence_string_values(qa_item)
    if artifact in evidence_values:
        return resolution_result(check_id, artifact, "qa_fixture_source_material", True, "qa.evidence.observed_or_expected")
    if qa_item["check_category"] == "file_integrity":
        resolved = artifact.endswith(".png") and {"checksum_sha256", "decoder_status"} <= observed_fields
        return resolution_result(check_id, artifact, "qa_fixture_source_material", resolved, "qa.evidence.observed.file_integrity")
    if qa_item["check_category"] == "product_logo_preservation":
        resolved = artifact.endswith((".svg", ".png")) and {
            "logo_similarity",
            "product_shape_similarity",
            "unauthorized_color_change",
        } <= observed_fields
        return resolution_result(check_id, artifact, "qa_fixture_source_material", resolved, "qa.evidence.observed.logo_preservation")
    if qa_item["check_category"] == "forbidden_claims":
        resolved = artifact.endswith(".md") and {"claim_text", "claim_source", "source_citation_present"} <= observed_fields
        return resolution_result(check_id, artifact, "qa_fixture_source_material", resolved, "qa.evidence.observed.claim_source")
    return resolution_result(check_id, artifact, "qa_fixture_source_material", False, "qa.evidence")


def observed_expected_result(
    check_id: str,
    artifact: str,
    resolver: str,
    required_fields: set[str],
    available_fields: set[str],
    evidence_ref: str,
    require_any: bool = False,
) -> dict[str, Any]:
    resolved = bool(required_fields & available_fields) if require_any else required_fields <= available_fields
    return resolution_result(check_id, artifact, resolver, resolved, evidence_ref)


def resolution_result(
    check_id: str,
    artifact: str,
    resolver: str,
    resolved: bool,
    evidence_ref: str,
) -> dict[str, Any]:
    return {
        "check_id": check_id,
        "artifact": artifact,
        "resolver": resolver,
        "resolved": resolved,
        "evidence_ref": evidence_ref,
    }


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


if __name__ == "__main__":
    raise SystemExit(main())
