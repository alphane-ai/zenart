#!/usr/bin/env python3
"""Run the guarded Stage 1 production source-to-launch pipeline.

This runner is for the moment when real production inputs are available. It
chains the production source probes, split child evidence generators, and
aggregate production launch generator without weakening any strict validators.
When required live inputs are missing it writes a non-clearing blocked summary
and exits 2; it does not write canonical production sources unless explicitly
asked with ``--write-canonical-sources``.
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
DEFAULT_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-source-pipeline.json"
DEFAULT_PRODUCTION_WEB_URL = "https://zenari.ai"
DEFAULT_BILLING_PROOF = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.candidate.json"
DEFAULT_SECURITY_PROOF = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.candidate.json"
DEFAULT_GOVERNANCE_PROOF = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.candidate.json"
DEFAULT_BILLING_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.billing.json"
DEFAULT_SECURITY_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.security.json"
DEFAULT_LEGAL_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.legal-support.json"
DEFAULT_GOVERNANCE_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.governance.json"
DEFAULT_LAUNCH_INPUT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-input-packet.json"
DEFAULT_MISSING_INPUT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")

SOURCE_INPUT_CONTRACT = [
    {
        "source_step_id": "legal_support_source_probe",
        "probe_id": "production_legal_support_policy",
        "coverage_group": "production_dns",
        "candidate_proof_attr": None,
        "proof_validator": None,
        "operator_next_action": "Finish production DNS/HTTPS cutover and rerun the legal/support source probe against public production pages.",
        "next_commands": [
            "python3 scripts/stage1_production_source_probe.py --legal-support --release-sha $(git rev-parse HEAD) --production-web-url https://zenari.ai --diagnostic ops/evidence/production/source-probe-diagnostics.legal-support.json --write-canonical-source",
            "python3 scripts/generate_stage1_production_legal_support_evidence.py --source ops/evidence/production/production-legal-support-source.json",
            "python3 scripts/validate_stage1_production_legal_support_evidence.py",
        ],
    },
    {
        "source_step_id": "billing_source_probe",
        "probe_id": "production_paid_billing_lifecycle",
        "coverage_group": "billing",
        "candidate_proof_attr": "billing_proof",
        "proof_validator": "python3 scripts/validate_stage1_stripe_live_billing_proof.py --proof {candidate_proof_path}",
        "operator_next_action": "Collect sanitized live Stripe production proof, validate it, then write the billing canonical source.",
        "next_commands": [
            "python3 scripts/stage1_stripe_live_billing_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-live-billing-proof.candidate.json <live-production-artifact-args>",
            "python3 scripts/validate_stage1_stripe_live_billing_proof.py --proof ops/evidence/non_clearing/production-live-billing-proof.candidate.json",
            "python3 scripts/stage1_production_source_probe.py --billing --release-sha $(git rev-parse HEAD) --billing-proof ops/evidence/non_clearing/production-live-billing-proof.candidate.json --diagnostic ops/evidence/production/source-probe-diagnostics.billing.json --write-canonical-source",
        ],
    },
    {
        "source_step_id": "security_source_probe",
        "probe_id": "production_security_launch_checks",
        "coverage_group": "security",
        "candidate_proof_attr": "security_proof",
        "proof_validator": "python3 scripts/validate_stage1_production_security_proof.py --proof {candidate_proof_path}",
        "operator_next_action": "Attach sanitized production security runtime refs and write the security canonical source.",
        "next_commands": [
            "python3 scripts/stage1_production_security_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-security-proof.candidate.json <production-runtime-ref-args>",
            "python3 scripts/validate_stage1_production_security_proof.py --proof ops/evidence/non_clearing/production-security-proof.candidate.json",
            "python3 scripts/stage1_production_source_probe.py --security --release-sha $(git rev-parse HEAD) --security-proof ops/evidence/non_clearing/production-security-proof.candidate.json --diagnostic ops/evidence/production/source-probe-diagnostics.security.json --write-canonical-source",
        ],
    },
    {
        "source_step_id": "governance_source_probe",
        "probe_id": "production_governance_release",
        "coverage_group": "governance",
        "candidate_proof_attr": "governance_proof",
        "proof_validator": "python3 scripts/validate_stage1_production_governance_proof.py --proof {candidate_proof_path}",
        "operator_next_action": "Attach sanitized production activation, abuse, and skill-release refs before writing governance source.",
        "next_commands": [
            "python3 scripts/stage1_production_governance_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-governance-proof.candidate.json <production-governance-ref-args>",
            "python3 scripts/validate_stage1_production_governance_proof.py --proof ops/evidence/non_clearing/production-governance-proof.candidate.json",
            "python3 scripts/stage1_production_source_probe.py --governance --release-sha $(git rev-parse HEAD) --governance-proof ops/evidence/non_clearing/production-governance-proof.candidate.json --diagnostic ops/evidence/production/source-probe-diagnostics.governance.json --write-canonical-source",
        ],
    },
]

SAFE_FALSE_FIELDS = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
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


class ProductionLaunchSourcePipelineError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def repo_path(ref: str) -> Path:
    path = Path(ref)
    if path.is_absolute():
        return path
    return ROOT / path


def current_release_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    value = result.stdout.strip().lower() if result.returncode == 0 else ""
    if not RELEASE_SHA_RE.fullmatch(value):
        raise ProductionLaunchSourcePipelineError("release_sha_missing_or_not_full_sha")
    return value


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionLaunchSourcePipelineError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionLaunchSourcePipelineError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_launch_source_pipeline")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_json_if_present(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ProductionLaunchSourcePipelineError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProductionLaunchSourcePipelineError(f"{display_path(path)} must contain a JSON object")
    assert_no_secret(data, display_path(path))
    return data


def scrub_output(text: str) -> str:
    cleaned = RAW_SECRET_RE.sub("[redacted]", text.strip())
    return cleaned[:1200]


def run_step(step_id: str, command: list[str], expected_success_codes: set[int]) -> dict[str, Any]:
    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    output = scrub_output(result.stderr or result.stdout)
    status = "pass" if result.returncode == 0 else ("blocked" if result.returncode == 2 else "failed")
    expected = result.returncode in expected_success_codes
    return {
        "step_id": step_id,
        "status": status,
        "exit_code": result.returncode,
        "expected_exit": expected,
        "command": " ".join(command),
        "output_summary": output,
    }


def source_probe_steps(args: argparse.Namespace, release_sha: str) -> list[tuple[str, list[str]]]:
    write_flag = ["--write-canonical-source"] if args.write_canonical_sources else []
    common = ["--release-sha", release_sha]
    billing_proof = ["--billing-proof", display_path(args.billing_proof)] if args.billing_proof.exists() else []
    security_proof = ["--security-proof", display_path(args.security_proof)] if args.security_proof.exists() else []
    governance_proof = ["--governance-proof", display_path(args.governance_proof)] if args.governance_proof.exists() else []
    return [
        (
            "billing_source_probe",
            [
                "python3",
                "scripts/stage1_production_source_probe.py",
                "--billing",
                *common,
                *billing_proof,
                "--diagnostic",
                display_path(args.billing_diagnostic),
                *write_flag,
            ],
        ),
        (
            "security_source_probe",
            [
                "python3",
                "scripts/stage1_production_source_probe.py",
                "--security",
                *common,
                *security_proof,
                "--production-web-url",
                args.production_web_url.rstrip("/"),
                "--diagnostic",
                display_path(args.security_diagnostic),
                *write_flag,
            ],
        ),
        (
            "legal_support_source_probe",
            [
                "python3",
                "scripts/stage1_production_source_probe.py",
                "--legal-support",
                *common,
                "--production-web-url",
                args.production_web_url.rstrip("/"),
                "--diagnostic",
                display_path(args.legal_diagnostic),
                *write_flag,
            ],
        ),
        (
            "governance_source_probe",
            [
                "python3",
                "scripts/stage1_production_source_probe.py",
                "--governance",
                *common,
                *governance_proof,
                "--diagnostic",
                display_path(args.governance_diagnostic),
                *write_flag,
            ],
        ),
    ]


def child_evidence_steps(release_sha: str) -> list[tuple[str, list[str]]]:
    return [
        (
            "billing_split_evidence",
            [
                "python3",
                "scripts/generate_stage1_production_billing_evidence.py",
                "--release-sha",
                release_sha,
            ],
        ),
        (
            "security_launch_evidence",
            [
                "python3",
                "scripts/generate_stage1_production_security_launch_evidence.py",
                "--release-sha",
                release_sha,
            ],
        ),
        (
            "legal_support_split_evidence",
            [
                "python3",
                "scripts/generate_stage1_production_legal_support_evidence.py",
                "--release-sha",
                release_sha,
            ],
        ),
        (
            "governance_release_split_evidence",
            [
                "python3",
                "scripts/generate_stage1_production_governance_release_evidence.py",
                "--release-sha",
                release_sha,
            ],
        ),
        ("production_launch_aggregate", ["python3", "scripts/generate_stage1_production_launch_evidence.py"]),
        (
            "production_launch_preflight_validation",
            [
                "python3",
                "scripts/validate_stage1_production_launch.py",
                "--allow-preflight",
            ],
        ),
    ]


def proof_readiness(args: argparse.Namespace) -> list[dict[str, Any]]:
    rows = [
        ("billing", args.billing_proof),
        ("security", args.security_proof),
        ("governance", args.governance_proof),
    ]
    return [
        {
            "proof_id": proof_id,
            "path": display_path(path),
            "exists": path.exists(),
            "required": True,
        }
        for proof_id, path in rows
    ]


def map_source_inputs(packet: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = packet.get("source_inputs")
    if not isinstance(rows, list):
        return {}
    mapped: dict[str, dict[str, Any]] = {}
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("probe_id"), str):
            mapped[row["probe_id"]] = row
    return mapped


def map_checklist_groups(checklist: dict[str, Any]) -> dict[str, dict[str, Any]]:
    groups = checklist.get("groups")
    if not isinstance(groups, list):
        return {}
    mapped: dict[str, dict[str, Any]] = {}
    for group in groups:
        if isinstance(group, dict) and isinstance(group.get("group_id"), str):
            mapped[group["group_id"]] = group
    return mapped


def safe_string(value: Any, limit: int = 700) -> str:
    text = str(value or "").strip()
    folded = " ".join(line.strip() for line in text.splitlines() if line.strip())
    return scrub_output(folded)[:limit]


def safe_string_list(value: Any, *, limit: int = 32, item_limit: int = 260) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value[:limit]:
        text = safe_string(item, item_limit)
        if text:
            result.append(text)
    return result


def missing_input_names(group: dict[str, Any]) -> list[str]:
    names = safe_string_list(group.get("first_missing_required_inputs"), limit=64)
    invalid = safe_string_list(group.get("invalid_required_inputs"), limit=64)
    if names or invalid:
        return [*names, *invalid]
    items = group.get("items")
    if not isinstance(items, list):
        return []
    result: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("status") not in {"missing", "invalid", "blocked"}:
            continue
        accepted = item.get("accepted_variable_names")
        if isinstance(accepted, list) and accepted:
            joined = " or ".join(safe_string(name) for name in accepted if safe_string(name))
            if joined:
                result.append(joined)
        else:
            display_name = safe_string(item.get("display_name"))
            if display_name:
                result.append(display_name)
    return result


def missing_source_inputs(args: argparse.Namespace) -> list[dict[str, Any]]:
    packet = read_json_if_present(args.launch_input_packet)
    checklist = read_json_if_present(args.missing_input_checklist)
    source_inputs = map_source_inputs(packet)
    checklist_groups = map_checklist_groups(checklist)

    rows: list[dict[str, Any]] = []
    for contract in SOURCE_INPUT_CONTRACT:
        source_input = source_inputs.get(contract["probe_id"], {})
        group = checklist_groups.get(contract["coverage_group"], {})
        candidate_path: Path | None = None
        if contract.get("candidate_proof_attr"):
            candidate_path = getattr(args, contract["candidate_proof_attr"])
        candidate_proof_path = display_path(candidate_path) if candidate_path is not None else None
        proof_validator_template = contract.get("proof_validator")
        proof_validator = (
            proof_validator_template.format(candidate_proof_path=candidate_proof_path)
            if isinstance(proof_validator_template, str) and candidate_proof_path
            else proof_validator_template
        )
        row = {
            "source_step_id": contract["source_step_id"],
            "probe_id": contract["probe_id"],
            "coverage_group": contract["coverage_group"],
            "status": "blocked",
            "ready_to_write_canonical_source": False,
            "candidate_proof_path": candidate_proof_path,
            "candidate_proof_exists": candidate_path.exists() if candidate_path is not None else None,
            "proof_validator": proof_validator,
            "canonical_source_path": safe_string(source_input.get("source_path")),
            "diagnostic_path": safe_string(source_input.get("diagnostic_path")),
            "source_template_ref": safe_string(source_input.get("source_template_ref")),
            "proof_template_ref": source_input.get("proof_template_ref"),
            "source_probe_command": safe_string(source_input.get("source_probe_command"), 900),
            "evidence_generator": safe_string(source_input.get("evidence_generator"), 900),
            "strict_validator": safe_string(source_input.get("strict_validator")),
            "blocking_input_count": group.get("blocking_input_count"),
            "required_configured": group.get("required_configured"),
            "required_total": group.get("required_total"),
            "completion_percent": group.get("completion_percent"),
            "first_blocker": (
                safe_string(source_input.get("first_blocker"))
                or safe_string(group.get("first_blocker"))
                or (missing_input_names(group)[0] if missing_input_names(group) else "production input missing")
            ),
            "missing_or_invalid_inputs": missing_input_names(group),
            "operator_next_action": contract["operator_next_action"],
            "next_commands": contract["next_commands"],
        }
        rows.append(row)
    return rows


def build_summary(
    *,
    args: argparse.Namespace,
    release_sha: str,
    steps: list[dict[str, Any]],
    blocked: bool,
    aggregate_attempted: bool,
) -> dict[str, Any]:
    blockers = [
        f"{step['step_id']}: {step['output_summary'] or 'exit_' + str(step['exit_code'])}"
        for step in steps
        if step.get("status") != "pass"
    ]
    data: dict[str, Any] = {
        "schema_version": "stage1.production_launch_source_pipeline.v1",
        "environment": "production",
        "kind": "stage1_production_launch_source_pipeline",
        "status": "blocked" if blocked else "pass",
        "release_gate_decision": "no_go" if blocked else "go_candidate_requires_strict_production_launch_validation",
        "generated_at": now(),
        "release_sha": release_sha,
        "non_clearing_pipeline_summary": blocked,
        "canonical_sources_requested": args.write_canonical_sources is True,
        "canonical_sources_may_be_written": args.write_canonical_sources is True,
        "production_web_url": args.production_web_url.rstrip("/"),
        "proof_readiness": proof_readiness(args),
        "missing_source_inputs": missing_source_inputs(args),
        "aggregate_attempted": aggregate_attempted,
        "steps": steps,
        "blocked_checks": blockers,
        "gate_impact": {
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete" if blocked else None,
            "can_clear_stage1_production_launch_gate": False,
            "requires_strict_validator": "python3 scripts/validate_stage1_production_launch.py",
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def run_pipeline(args: argparse.Namespace) -> int:
    release_sha = args.release_sha or current_release_sha()
    if not RELEASE_SHA_RE.fullmatch(release_sha):
        raise ProductionLaunchSourcePipelineError("release_sha_missing_or_not_full_sha")
    steps: list[dict[str, Any]] = []

    for step_id, command in source_probe_steps(args, release_sha):
        step = run_step(step_id, command, {0, 2})
        steps.append(step)
    sources_ready = args.write_canonical_sources and all(step.get("exit_code") == 0 for step in steps)
    aggregate_attempted = False

    if sources_ready:
        for step_id, command in child_evidence_steps(release_sha):
            expected = {0, 2} if step_id == "production_launch_aggregate" else {0}
            step = run_step(step_id, command, expected)
            steps.append(step)
            if step_id == "production_launch_aggregate":
                aggregate_attempted = True
            if step.get("exit_code") != 0 and step_id != "production_launch_aggregate":
                break
        blocked = any(step.get("exit_code") != 0 for step in steps)
    else:
        blocked = True

    summary = build_summary(
        args=args,
        release_sha=release_sha,
        steps=steps,
        blocked=blocked,
        aggregate_attempted=aggregate_attempted,
    )
    write_json(args.summary, summary)
    print(f"wrote Stage 1 production launch source pipeline summary to {display_path(args.summary)}")
    return 2 if blocked else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-sha", default="")
    parser.add_argument("--production-web-url", default=DEFAULT_PRODUCTION_WEB_URL)
    parser.add_argument("--billing-proof", type=Path, default=DEFAULT_BILLING_PROOF)
    parser.add_argument("--security-proof", type=Path, default=DEFAULT_SECURITY_PROOF)
    parser.add_argument("--governance-proof", type=Path, default=DEFAULT_GOVERNANCE_PROOF)
    parser.add_argument("--billing-diagnostic", type=Path, default=DEFAULT_BILLING_DIAGNOSTIC)
    parser.add_argument("--security-diagnostic", type=Path, default=DEFAULT_SECURITY_DIAGNOSTIC)
    parser.add_argument("--legal-diagnostic", type=Path, default=DEFAULT_LEGAL_DIAGNOSTIC)
    parser.add_argument("--governance-diagnostic", type=Path, default=DEFAULT_GOVERNANCE_DIAGNOSTIC)
    parser.add_argument("--launch-input-packet", type=Path, default=DEFAULT_LAUNCH_INPUT_PACKET)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_MISSING_INPUT_CHECKLIST)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--write-canonical-sources", action="store_true")
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if args.write_canonical_sources:
            raise SystemExit("contract-only mode must not write canonical production sources")
        print("stage1 production launch source pipeline runner contract passed")
        return 0
    try:
        return run_pipeline(args)
    except ProductionLaunchSourcePipelineError as exc:
        print(f"stage1 production launch source pipeline failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
