#!/usr/bin/env python3
"""Validate the Stage 0 Rev2 eval runner manifest contract."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "eval_runner_manifest_contract.json"
EVAL_RESULTS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "starter_eval_results.json"
RUNNER = ROOT / "scripts" / "run_stage0_eval.py"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
STAGE0_VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"
DETERMINISTIC_COMPLETED_AT = "2026-05-26T00:00:00Z"

REQUIRED_SOURCE_PATHS = [
    "fixtures/stage0/rev2/eval/starter_eval_suite.json",
    "fixtures/stage0/rev2/eval/qa_results.json",
    "fixtures/stage0/rev2/eval/safety_rules.json",
    "fixtures/stage0/rev2/workflows/business_visual_doc_pack.json",
    "fixtures/stage0/rev2/workflows/character_ip_concept_pack.json",
    "fixtures/stage0/rev2/workflows/ecommerce_growth_pack.json",
    "fixtures/stage0/rev2/workflows/local_merchant_campaign_pack.json",
]

REQUIRED_STALE_CASES = {
    "runner_sha256": "runner_digest_mismatch",
    "runner_manifest_sha256": "runner_manifest_digest_mismatch",
    "starter_eval_suite_digest": "source_fixture_digest_mismatch",
    "qa_results_digest": "source_fixture_digest_mismatch",
    "safety_rules_digest": "source_fixture_digest_mismatch",
    "workflow_acceptance_digest": "source_fixture_digest_mismatch",
    "stored_result_json": "stored_result_stale",
}


class EvalRunnerManifestContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalRunnerManifestContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalRunnerManifestContractError(message)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def runner_sha256() -> str:
    content = RUNNER.read_text(encoding="utf-8")
    normalized = "\n".join(
        '            "runner_sha256": "<self>",' if '"runner_sha256": runner_digest' in line else line
        for line in content.splitlines()
    )
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def expected_source_fixture_digests() -> list[dict[str, str]]:
    return [
        {
            "path": source_path,
            "sha256": file_sha256(ROOT / source_path),
        }
        for source_path in REQUIRED_SOURCE_PATHS
    ]


def schema_block(openapi_text: str, schema_name: str) -> str:
    match = re.search(
        rf"^    {schema_name}:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(match is not None, f"OpenAPI schema {schema_name} missing")
    return match.group("body")


def stale_case_error(case: dict[str, Any], stored_result: dict[str, Any], contract: dict[str, Any]) -> str:
    mutated = case["mutated_input"]

    if mutated == "runner_sha256":
        changed = copy.deepcopy(stored_result)
        changed["runner_contract"]["runner_sha256"] = "0" * 64
        return "runner_digest_mismatch" if changed["runner_contract"]["runner_sha256"] != runner_sha256() else ""

    if mutated == "runner_manifest_sha256":
        changed_manifest = copy.deepcopy(stored_result["runner_contract"])
        changed_manifest["check_mode_compares_exact_json"] = False
        return (
            "runner_manifest_digest_mismatch"
            if canonical_sha256(changed_manifest) != contract["runner_manifest"]["runner_manifest_sha256"]
            else ""
        )

    if mutated in {
        "starter_eval_suite_digest",
        "qa_results_digest",
        "safety_rules_digest",
        "workflow_acceptance_digest",
    }:
        changed = copy.deepcopy(contract["input_manifest"]["source_fixture_digests"])
        target_prefixes = {
            "starter_eval_suite_digest": ("fixtures/stage0/rev2/eval/starter_eval_suite.json",),
            "qa_results_digest": ("fixtures/stage0/rev2/eval/qa_results.json",),
            "safety_rules_digest": ("fixtures/stage0/rev2/eval/safety_rules.json",),
            "workflow_acceptance_digest": ("fixtures/stage0/rev2/workflows/",),
        }[mutated]
        for item in changed:
            if any(item["path"].startswith(prefix) for prefix in target_prefixes):
                item["sha256"] = "f" * 64
                break
        return (
            "source_fixture_digest_mismatch"
            if changed != expected_source_fixture_digests()
            else ""
        )

    if mutated == "stored_result_json":
        changed = copy.deepcopy(stored_result)
        changed["status"] = "pass" if changed["status"] != "pass" else "blocked"
        return "stored_result_stale" if changed != stored_result else ""

    raise EvalRunnerManifestContractError(f"unsupported stale input mutation {mutated!r}")


def validate_contract() -> None:
    contract = load_json(CONTRACT)
    results = load_json(EVAL_RESULTS)
    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    result = results[0]

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "runner manifest must cite Rev2")
    stored_ref = contract["stored_result_ref"]
    require(stored_ref["result_id"] == result["result_id"], "stored result id mismatch")
    require(stored_ref["suite_id"] == result["suite_id"], "stored suite id mismatch")
    require(stored_ref["status"] == result["status"], "stored status mismatch")
    require(stored_ref["runner_contract_path"] == "runner_contract", "runner contract path mismatch")

    manifest = contract["runner_manifest"]
    runner_contract = result["runner_contract"]
    require(manifest["runner"] == runner_contract["runner"], "runner path mismatch")
    require(manifest["runner_sha256"] == runner_contract["runner_sha256"], "manifest runner hash mismatch")
    require(manifest["runner_sha256"] == runner_sha256(), "runner hash must match current script")
    require(
        manifest["runner_manifest_sha256"] == canonical_sha256(runner_contract),
        "runner manifest hash must match stored runner_contract",
    )
    require(
        manifest["deterministic_replay_command"] == runner_contract["deterministic_replay_command"],
        "replay command mismatch",
    )
    require(
        manifest["writes_stored_fixture"] is runner_contract["writes_stored_fixture"] is True,
        "write fixture flag mismatch",
    )
    require(
        manifest["check_mode_compares_exact_json"] is runner_contract["check_mode_compares_exact_json"] is True,
        "exact JSON check flag mismatch",
    )
    require(manifest["normalizes_self_hash_field"] is True, "runner self-hash normalization must be explicit")
    require(manifest["forbids_network_access"] is True, "runner manifest must forbid network access")
    require(manifest["forbids_wall_clock_outputs"] is True, "runner manifest must forbid wall-clock output")
    require(result["completed_at"] == DETERMINISTIC_COMPLETED_AT, "stored eval completed_at must be deterministic")
    require(result["created_at"] == DETERMINISTIC_COMPLETED_AT, "stored eval created_at must be deterministic")
    require(manifest["deterministic_completed_at"] == DETERMINISTIC_COMPLETED_AT, "manifest completed_at mismatch")

    runner_text = RUNNER.read_text(encoding="utf-8")
    require("urllib" not in runner_text and "requests" not in runner_text, "eval runner must not use network clients")
    require("datetime.now" not in runner_text and "time.time" not in runner_text, "eval runner must not use wall-clock outputs")
    require("DETERMINISTIC_COMPLETED_AT" in runner_text, "eval runner must use deterministic completed_at")
    require("runner_sha256\": \"<self>" in runner_text, "eval runner must normalize self hash field")

    input_manifest = contract["input_manifest"]
    expected_digests = expected_source_fixture_digests()
    require(input_manifest["source_fixture_count"] == len(expected_digests), "source fixture count mismatch")
    require(input_manifest["source_fixture_digests"] == expected_digests, "input manifest source digests mismatch")
    require(runner_contract["source_fixture_digests"] == expected_digests, "stored result source digests mismatch")
    require(
        sorted(item["path"] for item in input_manifest["source_fixture_digests"]) == sorted(REQUIRED_SOURCE_PATHS),
        "input manifest must cover exact eval, QA, safety, and workflow fixtures",
    )
    workflow_paths = [
        item["path"]
        for item in input_manifest["source_fixture_digests"]
        if item["path"].startswith("fixtures/stage0/rev2/workflows/")
    ]
    require(len(workflow_paths) == 4, "input manifest must include all four workflow acceptance fixtures")

    for key, value in contract["execution_contract"].items():
        require(value is True, f"execution contract {key} must be true")

    cases = contract["stale_input_rejection_cases"]
    case_map = {case["mutated_input"]: case for case in cases}
    require(set(case_map) == set(REQUIRED_STALE_CASES), "stale input cases must cover each required mutation")
    require(len(case_map) == len(cases), "stale input mutations must be unique")
    for mutated_input, expected_error in REQUIRED_STALE_CASES.items():
        case = case_map[mutated_input]
        require(case["expected_error"] == expected_error, f"{mutated_input} expected error mismatch")
        require(case["activation_allowed"] is False, f"{mutated_input} must deny activation")
        require(case["admin_read_requires_rerun"] is False, f"{mutated_input} admin reads must not rerun eval")
        require(stale_case_error(case, result, contract) == expected_error, f"{mutated_input} stale replay mismatch")

    openapi_body = schema_block(OPENAPI.read_text(encoding="utf-8"), contract["openapi_projection_contract"]["schema_name"])
    for field in contract["openapi_projection_contract"]["required_projection_fields"]:
        require(field in openapi_body, f"OpenAPI EvalResult runner projection missing {field}")
    for token in contract["openapi_projection_contract"]["required_description_tokens"]:
        require(token in openapi_body, f"OpenAPI EvalResult runner projection missing description token {token!r}")

    validator = contract["validator_contract"]
    for key, value in validator.items():
        if isinstance(value, bool):
            require(value is True, f"validator contract {key} must be true")
    require((ROOT / validator["validator"]).exists(), "runner manifest validator is missing")
    require(
        "validate_eval_runner_manifest_contract" in STAGE0_VALIDATOR.read_text(encoding="utf-8"),
        "runner manifest validator must be wired into validate_stage0_rev2.py",
    )

    replay = subprocess.run(
        [sys.executable, str(RUNNER), "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(replay.returncode == 0, "eval runner exact replay failed: " + (replay.stderr or replay.stdout).strip())


def main() -> int:
    try:
        validate_contract()
    except EvalRunnerManifestContractError as exc:
        print(f"eval runner manifest contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("eval runner manifest contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
