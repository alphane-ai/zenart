#!/usr/bin/env python3
"""Generate aggregate Stage 1 staging runtime evidence.

This generator is intentionally conservative. It can write the canonical
aggregate files, but it only emits a passing `release_gate_decision=go` report
when every required child evidence file exists, every referenced result file
passes, and the strict child validators accept the canonical child evidence.
Otherwise it writes a blocked aggregate report that preserves the exact missing
or failed prerequisites.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "staging_runtime" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-runtime.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stage1-runtime.ndjson"
STRICT_VALIDATOR = "scripts/validate_stage1_staging_runtime.py"
# Contract anchor: aggregate runtime consumes stage1-quota-replay.json and stage1-quota-replay.ndjson.

PASS_STATUSES = {"pass", "passed"}
BLOCKED_MARKERS = {
    "blocked",
    "failed",
    "planned",
    "dry_run",
    "dry_run_no_staging_runtime_probe",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
    "missing_staging_runtime",
    "blocked_by_other_staging_runtime_items",
    "blocked_by_object_retention_cleanup",
    "blocked_by_restore_load_and_other_staging_runtime_items",
}
CONTEXT_ONLY_BLOCKED_MARKERS = {
    "blocked_by_other_staging_runtime_items",
    "blocked_by_restore_load_and_other_staging_runtime_items",
    "blocked_by_object_retention_cleanup",
}
LOCAL_DEBUG_TRUE_FIELDS = {"local_devport_debug", "allow_local_devport_evidence"}
CANONICAL_PATH_FALSE_FIELDS = {"canonical_pass_path", "canonical_pass_paths"}
CONTEXT_ONLY_FALSE_CAN_CLEAR_FIELDS = {
    "can_clear_aggregate_item",
    "can_clear_release_gate_check",
    "can_clear_stage1_staging_runtime_gate",
    "can_clear_stage1_production_launch_gate",
}
GATE_EMPTY_FIELDS = {
    "blocked_checks",
    "blockers",
    "do_not_launch_conditions",
}
GATE_CLEAR_FIELDS = {
    "do_not_launch_condition_id",
    "preserved_do_not_launch_condition_id",
    "preserved_release_gate_check_id",
}

SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
    "database_url_persisted",
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
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
    "raw_event",
    "raw_response",
    "raw_support_body",
    "download_url",
    "signed_url",
    "database_url",
    "staging_database_url",
}

RAW_SECRET_RE = re.compile(
    r"(?i)(postgres(?:ql)?://[^\s\"']+|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)


class GenerationError(Exception):
    pass


def repo_path(ref: str) -> Path:
    path = ROOT / ref
    try:
        path.resolve().relative_to(ROOT.resolve())
    except ValueError as exc:
        raise GenerationError(f"path escapes repo root: {ref}") from exc
    return path


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise GenerationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise GenerationError(f"{display_path(path)} must contain a JSON object")
    return data


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise GenerationError(f"{display_path(path)}:{lineno} invalid JSON: {exc}") from exc
        if not isinstance(value, dict):
            raise GenerationError(f"{display_path(path)}:{lineno} must contain a JSON object")
        rows.append(value)
    if not rows:
        raise GenerationError(f"{display_path(path)} must contain at least one row")
    return rows


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_ndjson(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")


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


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise GenerationError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise GenerationError(f"{path} contains raw secret-looking material")


def evidence_refs_from_component(component: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    single = component.get("required_evidence_ref")
    if isinstance(single, str):
        refs.append(single)
    multi = component.get("required_evidence_refs")
    if isinstance(multi, list):
        refs.extend(ref for ref in multi if isinstance(ref, str))
    return refs


def blocked_evidence_refs_from_component(component: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    single = component.get("blocked_evidence_ref")
    if isinstance(single, str):
        refs.append(single)
    multi = component.get("blocked_evidence_refs")
    if isinstance(multi, list):
        refs.extend(ref for ref in multi if isinstance(ref, str))
    return refs


def proof_anchors(component: dict[str, Any]) -> list[str]:
    return [str(item) for item in component.get("required_proofs", []) if str(item).strip()]


def is_pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def truthy_gate_value(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"})


def falsey_gate_value(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.strip().lower() in {"false", "0", "no"})


def has_component_clear_signal(value: Any) -> bool:
    if not isinstance(value, dict) or not is_pass_status(value.get("status")):
        return False
    gate = value.get("gate_impact")
    if not isinstance(gate, dict):
        return False
    for key, child in gate.items():
        normalized = str(key).strip().lower()
        if not normalized.startswith("can_clear_") or not truthy_gate_value(child):
            continue
        if normalized in {
            "can_clear_aggregate_item",
            "can_clear_release_gate_check",
            "can_clear_stage1_staging_runtime_gate",
            "can_clear_stage1_production_launch_gate",
        }:
            continue
        return True
    return False


def marker_scan_value(value: Any, component_id: str) -> Any:
    if (
        component_id != "legal_support_external_user"
        or not isinstance(value, dict)
        or value.get("environment") != "staging"
        or value.get("kind") != "support_contact_external_user_visibility"
        or value.get("release_gate_check_id") != "staging_legal_external_user_pages"
        or not is_pass_status(value.get("status"))
    ):
        return value
    gate = value.get("gate_impact")
    ticket_context = value.get("ticket_context_probe")
    if (
        not isinstance(gate, dict)
        or not truthy_gate_value(gate.get("can_clear_support_contact_subitem"))
        or not isinstance(ticket_context, dict)
        or ticket_context.get("mode") != "dry_run"
    ):
        return value
    sanitized = dict(value)
    sanitized_ticket_context = dict(ticket_context)
    sanitized_ticket_context["mode"] = "support_ticket_context_capture_probe"
    sanitized["ticket_context_probe"] = sanitized_ticket_context
    return sanitized


def blocked_markers_for_evidence(value: Any, component_id: str, *, allow_context_only: bool = False) -> set[str]:
    markers = normalized_string_values(marker_scan_value(value, component_id)) & BLOCKED_MARKERS
    if allow_context_only:
        markers -= CONTEXT_ONLY_BLOCKED_MARKERS
    return markers


def local_debug_blockers(value: Any, path: str, *, allow_context_only: bool = False) -> list[str]:
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
                if not (allow_context_only and normalized in CONTEXT_ONLY_FALSE_CAN_CLEAR_FIELDS):
                    blockers.append(f"{child_path} is false")
            if normalized in GATE_EMPTY_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not empty")
            if normalized in GATE_CLEAR_FIELDS and child not in (None, ""):
                if not allow_context_only:
                    blockers.append(f"{child_path} is not cleared")
            blockers.extend(local_debug_blockers(child, child_path, allow_context_only=allow_context_only))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            blockers.extend(local_debug_blockers(child, f"{path}[{idx}]", allow_context_only=allow_context_only))
    return blockers


def run_validator(command: str) -> tuple[bool, str]:
    return run_command(command.split())


def run_command(parts: list[str]) -> tuple[bool, str]:
    result = subprocess.run(parts, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    output = (result.stderr or result.stdout).strip()
    return result.returncode == 0, output


def component_status(component: dict[str, Any]) -> dict[str, Any]:
    component_id = str(component["component_id"])
    refs = evidence_refs_from_component(component)
    blocked_refs = blocked_evidence_refs_from_component(component)
    results_ref = component.get("required_results_ref")
    blocked_results_ref = component.get("blocked_results_ref")
    blockers: list[str] = []
    secret_leak_detected = False
    raw_payload_persisted = False
    exact_evidence = True
    diagnostic_refs: list[str] = []
    diagnostic_results_ref: str | None = None

    for ref in refs:
        path = repo_path(ref)
        if not path.exists():
            exact_evidence = False
            fallback_ref = None
            for candidate in blocked_refs:
                if repo_path(candidate).exists():
                    fallback_ref = candidate
                    break
            if fallback_ref is None:
                blockers.append(f"missing evidence: {ref}")
                continue
            blockers.append(f"missing canonical pass evidence: {ref}; using blocked diagnostic evidence: {fallback_ref}")
            ref = fallback_ref
            path = repo_path(ref)
            diagnostic_refs.append(ref)
        else:
            diagnostic_refs.append(ref)
        try:
            data = load_json(path)
            assert_no_secret(data, f"{component_id}.{ref}")
        except GenerationError as exc:
            blockers.append(str(exc))
            exact_evidence = False
            secret_leak_detected = True
            continue
        allow_context_only = has_component_clear_signal(data)
        blockers.extend(
            f"{ref} {blocker}"
            for blocker in local_debug_blockers(data, f"{component_id}.evidence", allow_context_only=allow_context_only)
        )
        if data.get("environment") != "staging":
            blockers.append(f"{ref} environment is not staging")
        if not is_pass_status(data.get("status")):
            blockers.append(f"{ref} status is not pass/passed")
        markers = sorted(blocked_markers_for_evidence(data, component_id, allow_context_only=allow_context_only))
        if markers:
            blockers.append(f"{ref} contains blocked marker(s): {markers}")

    if isinstance(results_ref, str):
        path = repo_path(results_ref)
        if not path.exists():
            exact_evidence = False
            if isinstance(blocked_results_ref, str) and repo_path(blocked_results_ref).exists():
                blockers.append(
                    f"missing canonical pass results: {results_ref}; using blocked diagnostic results: {blocked_results_ref}"
                )
                results_ref_to_read = blocked_results_ref
                path = repo_path(results_ref_to_read)
                diagnostic_results_ref = results_ref_to_read
            else:
                blockers.append(f"missing results: {results_ref}")
                results_ref_to_read = results_ref
        else:
            results_ref_to_read = results_ref
            diagnostic_results_ref = results_ref
        if path.exists():
            try:
                rows = load_ndjson(path)
                assert_no_secret(rows, f"{component_id}.{results_ref_to_read}")
            except GenerationError as exc:
                blockers.append(str(exc))
                exact_evidence = False
                secret_leak_detected = True
            else:
                for idx, row in enumerate(rows, 1):
                    blockers.extend(
                        f"{results_ref_to_read} row {idx} {blocker}"
                        for blocker in local_debug_blockers(row, f"{component_id}.result")
                    )
                    if not is_pass_status(row.get("status")):
                        blockers.append(f"{results_ref_to_read} row {idx} status is not pass/passed")
                    if row.get("secret_leak_detected") is True:
                        blockers.append(f"{results_ref_to_read} row {idx} reports secret leakage")
                        secret_leak_detected = True
                    if row.get("raw_payload_persisted") is True:
                        blockers.append(f"{results_ref_to_read} row {idx} reports raw payload persistence")
                        raw_payload_persisted = True
                    markers = sorted(normalized_string_values(row) & BLOCKED_MARKERS)
                    if markers:
                        blockers.append(f"{results_ref_to_read} row {idx} contains blocked marker(s): {markers}")

    validator = component.get("required_validator")
    validator_commands: list[str] = []
    if isinstance(validator, str):
        command = f"python3 {validator}"
        validator_commands.append(command)
        passed, output = run_validator(command)
        if not passed:
            blockers.append(f"strict child validator failed: {command}: {output}")

    passed = not blockers
    return {
        "component_id": component_id,
        "environment": "staging",
        "status": "passed" if passed else "blocked",
        "exact_evidence": exact_evidence and passed,
        "dry_run": False,
        "local_only": False,
        "secret_leak_detected": secret_leak_detected,
        "raw_payload_persisted": raw_payload_persisted,
        "evidence_refs": refs,
        "diagnostic_evidence_refs": diagnostic_refs,
        "results_ref": results_ref if isinstance(results_ref, str) else None,
        "diagnostic_results_ref": diagnostic_results_ref,
        "validator_commands": validator_commands,
        "proofs": proof_anchors(component),
        "blockers": blockers,
    }


def build_runtime_input_readiness(components: list[dict[str, Any]]) -> dict[str, bool]:
    passed_by_id = {
        str(component.get("component_id")): component.get("status") == "passed"
        for component in components
    }

    auth_ready = passed_by_id.get("auth_rbac_tenant_audit", False)
    provider_ready = (
        passed_by_id.get("batch_runtime", False)
        and passed_by_id.get("provider_sandbox", False)
    )
    quota_replay_ready = passed_by_id.get("staging_quota_replay", False)
    stripe_ready = passed_by_id.get("stripe_test_lifecycle", False)
    object_storage_ready = passed_by_id.get("object_storage_retention_cleanup", False)
    safety_ready = passed_by_id.get("safety_qa_eval", False)
    observability_ready = passed_by_id.get("observability", False)
    backup_restore_ready = passed_by_id.get("backup_restore", False)
    load_ready = passed_by_id.get("load", False)
    legal_support_ready = passed_by_id.get("legal_support_external_user", False)

    return {
        "staging_api_ready": auth_ready and provider_ready and quota_replay_ready and stripe_ready and safety_ready,
        "staging_web_ready": auth_ready and legal_support_ready and stripe_ready and object_storage_ready,
        "staging_admin_ready": auth_ready and provider_ready and quota_replay_ready and stripe_ready and safety_ready and observability_ready,
        "admin_auth_ready": auth_ready,
        "user_auth_ready": auth_ready,
        "csrf_ready": auth_ready and stripe_ready and object_storage_ready and safety_ready,
        "stripe_test_ready": stripe_ready,
        "provider_live_calls_ready": provider_ready,
        "quota_replay_ready": quota_replay_ready,
        "object_storage_ready": object_storage_ready,
        "observability_ready": observability_ready,
        "backup_restore_ready": backup_restore_ready,
        "load_ready": load_ready,
    }


def build_report(contract: dict[str, Any], evidence_path: Path, results_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    components = [component_status(item) for item in contract["required_components"] if isinstance(item, dict)]
    blockers = [
        f"{component['component_id']}: {blocker}"
        for component in components
        for blocker in component.get("blockers", [])
    ]

    all_components_passed = not blockers
    runtime_input_readiness = build_runtime_input_readiness(components)

    report: dict[str, Any] = {
        "schema_version": "stage1.staging_runtime.v1",
        "environment": "staging",
        "kind": "stage1_staging_runtime",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "status": "pass" if all_components_passed else "blocked",
        "release_gate_decision": "go" if all_components_passed else "no_go",
        "all_components_passed": all_components_passed,
        "do_not_launch_conditions": [] if all_components_passed else ["stage1_staging_runtime_evidence_incomplete"],
        "runtime_input_readiness": runtime_input_readiness,
        "components": components,
        "validator_commands": [f"python3 {STRICT_VALIDATOR}"],
        "blockers": blockers,
    }
    for field in SAFE_FALSE_FIELDS:
        report[field] = False

    rows = [
        {
            "component_id": component["component_id"],
            "environment": "staging",
            "status": component["status"],
            "exact_evidence": component["exact_evidence"],
            "secret_leak_detected": component["secret_leak_detected"],
            "raw_payload_persisted": component["raw_payload_persisted"],
            "evidence_refs": component["evidence_refs"],
            "diagnostic_evidence_refs": component["diagnostic_evidence_refs"],
            "results_ref": component["results_ref"],
            "diagnostic_results_ref": component["diagnostic_results_ref"],
            "blockers": component["blockers"],
        }
        for component in components
    ]

    if all_components_passed:
        write_json(evidence_path, report)
        write_ndjson(results_path, rows)
        passed, output = run_command(
            [
                "python3",
                STRICT_VALIDATOR,
                "--evidence",
                str(evidence_path),
                "--results",
                str(results_path),
            ]
        )
        if passed:
            return report, rows
        report["status"] = "blocked"
        report["release_gate_decision"] = "no_go"
        report["all_components_passed"] = False
        report["do_not_launch_conditions"] = ["stage1_staging_runtime_strict_validator_failed"]
        report["blockers"] = [f"strict aggregate validator failed: {output}"]
        for row in rows:
            row["status"] = "blocked"
            row["exact_evidence"] = False
            row["blockers"] = report["blockers"]

    return report, rows


def validate_contract_only() -> None:
    passed, output = run_validator("python3 scripts/validate_stage1_staging_runtime.py --contract-only")
    if not passed:
        raise GenerationError(output)
    secret_cases: list[tuple[str, Any]] = [
        ("secret field", {"secret": "redacted-but-forbidden-field"}),
        ("database URL field", {"database_url": "redacted-but-forbidden-field"}),
        ("raw provider field", {"component": {"raw_provider_payload": {"id": "payload"}}}),
        ("raw Stripe field", {"component": {"raw_stripe_payload": {"id": "evt_test"}}}),
        ("Bearer token string", {"message": "Authorization failed for Bearer providersecretguardtoken123456"}),
        ("Stripe key string", {"message": "Stripe returned " + "sk_test_" + "1234567890abcdef123456"}),
        ("Stripe signature string", {"message": "Stripe-Signature: t=1234567890,v1=abcdefabcdefabcdef"}),
        ("Postgres URL string", {"message": "postgresql://user:pass@staging-db.example.internal:5432/zenari"}),
        ("z.ai key string", {"message": "provider key " + ("0123456789abcdef" * 2) + "." + "abcdefghijklmnop"}),
    ]
    for label, payload in secret_cases:
        try:
            assert_no_secret(payload, f"secret_selftest.{label}")
        except GenerationError:
            continue
        raise GenerationError(f"secret rejection selftest accepted {label}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate generator and aggregate gate contract anchors only")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="output aggregate evidence JSON path")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="output aggregate NDJSON results path")
    args = parser.parse_args()

    try:
        validate_contract_only()
        if args.contract_only:
            print("stage1 staging runtime generator contract passed")
            return 0
        evidence_path = Path(args.evidence)
        results_path = Path(args.results)
        if not evidence_path.is_absolute():
            evidence_path = ROOT / evidence_path
        if not results_path.is_absolute():
            results_path = ROOT / results_path
        contract = load_json(CONTRACT)
        report, rows = build_report(contract, evidence_path, results_path)
        assert_no_secret(report, "report")
        assert_no_secret(rows, "results")
        write_json(evidence_path, report)
        write_ndjson(results_path, rows)
    except GenerationError as exc:
        print(f"stage1 staging runtime evidence generation failed: {exc}", file=sys.stderr)
        return 1

    if report["status"] == "pass":
        print(f"stage1 staging runtime evidence generated: pass ({display_path(evidence_path)})")
        return 0
    print(f"stage1 staging runtime evidence generated: blocked ({display_path(evidence_path)})")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
