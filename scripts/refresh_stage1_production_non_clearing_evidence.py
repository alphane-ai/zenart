#!/usr/bin/env python3
"""Refresh Stage 1 production blocker evidence without clearing launch gates.

This runner exists to reduce the final pre-launch loop. It reruns the current
non-clearing DNS, proof-bundle, operator-packet, runbook, checklist, and action
matrix evidence in the order their validators expect. It never applies DNS
changes and never writes canonical production source probes.
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
DEFAULT_ENV = ROOT / ".env"
DEFAULT_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-non-clearing-refresh.json"
DEFAULT_PRODUCTION_WEB_URL = "https://zenari.ai"
DEFAULT_STAGING_WEB_URL = "https://staging.zenari.ai"
DEFAULT_RELEASE_BRIEF = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-operator-brief.json"
DEFAULT_MISSING_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
DEFAULT_ACTION_MATRIX = ROOT / "ops" / "evidence" / "non_clearing" / "production-action-matrix.json"
DEFAULT_DNS_READINESS = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_DNS_CUTOVER_PLAN = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-cutover-plan.json"
DEFAULT_PROOF_BUNDLE = ROOT / "ops" / "evidence" / "non_clearing" / "production-proof-bundle.json"
DEFAULT_PIPELINE_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-source-pipeline.json"
DEFAULT_NEXT_BLOCKERS_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.json"
DEFAULT_CLOSURE_QUEUE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-evidence-closure-queue.preflight.json"
DEFAULT_BILLING_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.blocked.json"
DEFAULT_SECURITY_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.blocked.json"
DEFAULT_GOVERNANCE_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.blocked.json"
DEFAULT_LEGAL_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.legal-support.json"
DEFAULT_EXTERNAL_READINESS = (
    ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-external-resource-readiness.preflight.json"
)

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
EXPECTED_STEP_IDS = [
    "billing_live_proof_template",
    "production_source_probe_templates",
    "validate_production_source_probe_templates",
    "production_input_template",
    "validate_production_input_template",
    "production_dns_readiness",
    "validate_production_dns_readiness",
    "production_dns_cutover_plan",
    "validate_production_dns_cutover_plan",
    "production_proof_bundle",
    "validate_production_proof_bundle",
    "validate_production_launch_source_pipeline",
    "production_billing_operator_packet",
    "validate_production_billing_operator_packet",
    "production_security_operator_packet",
    "validate_production_security_operator_packet",
    "production_legal_support_operator_packet",
    "validate_production_legal_support_operator_packet",
    "production_governance_operator_packet",
    "validate_production_governance_operator_packet",
    "external_resource_readiness",
    "validate_external_resource_readiness",
    "production_launch_input_packet",
    "validate_production_launch_input_packet",
    "production_blocker_audit",
    "validate_production_blocker_audit",
    "production_launch_operator_brief",
    "validate_production_launch_operator_brief",
    "production_missing_input_checklist",
    "validate_production_missing_input_checklist",
    "production_source_probe_runbook",
    "validate_production_source_probe_runbook",
    "production_dns_repair_packet",
    "validate_production_dns_repair_packet",
    "production_blocker_checklist",
    "validate_production_blocker_checklist",
    "production_action_matrix",
    "validate_production_action_matrix",
]


class ProductionNonClearingRefreshError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def repo_path(path: str | Path) -> Path:
    value = Path(path)
    return value if value.is_absolute() else ROOT / value


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionNonClearingRefreshError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionNonClearingRefreshError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_non_clearing_refresh")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def scrub(text: str) -> str:
    cleaned = RAW_SECRET_RE.sub("[redacted]", text.strip())
    return " ".join(line.strip() for line in cleaned.splitlines() if line.strip())[:1200]


def step_timeout(step_id: str, probe_timeout: float) -> float:
    if step_id == "production_dns_readiness":
        return max(90.0, min(180.0, probe_timeout * 18.0))
    if step_id in {
        "production_dns_cutover_plan",
        "validate_production_dns_cutover_plan",
        "production_proof_bundle",
        "production_launch_input_packet",
    }:
        return max(30.0, min(90.0, probe_timeout * 12.0))
    return 45.0


def run_step(step_id: str, command: list[str], expected_exit_codes: set[int], timeout: float) -> dict[str, Any]:
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        output = "\n".join(part for part in (exc.stderr, exc.stdout, f"step hard timeout after {timeout:.1f}s") if part)
        return {
            "step_id": step_id,
            "status": "blocked",
            "exit_code": 124,
            "expected_exit": 2 in expected_exit_codes,
            "command": " ".join(command),
            "output_summary": scrub(output),
        }
    status = "pass" if result.returncode == 0 else ("blocked" if result.returncode == 2 else "failed")
    return {
        "step_id": step_id,
        "status": status,
        "exit_code": result.returncode,
        "expected_exit": result.returncode in expected_exit_codes,
        "command": " ".join(command),
        "output_summary": scrub(result.stderr or result.stdout),
    }


def command_sequence(args: argparse.Namespace) -> list[tuple[str, list[str], set[int]]]:
    production_web_url = args.production_web_url.rstrip("/")
    staging_web_url = args.staging_web_url.rstrip("/")
    env_path = display_path(args.env)
    return [
        (
            "billing_live_proof_template",
            [
                "python3",
                "scripts/stage1_billing_live_proof_template.py",
                "--output",
                "ops/evidence/non_clearing/templates/billing-live-proof.template.json",
                "--self-test",
            ],
            {0},
        ),
        (
            "production_source_probe_templates",
            [
                "python3",
                "scripts/generate_stage1_production_source_probe_templates.py",
                "--output-dir",
                "ops/evidence/non_clearing/templates/production-source-probes",
                "--self-test",
            ],
            {0},
        ),
        (
            "validate_production_source_probe_templates",
            [
                "python3",
                "scripts/validate_stage1_production_source_probe_templates.py",
                "--template-dir",
                "ops/evidence/non_clearing/templates/production-source-probes",
            ],
            {0},
        ),
        ("production_input_template", ["python3", "scripts/generate_stage1_production_input_template.py"], {0}),
        ("validate_production_input_template", ["python3", "scripts/validate_stage1_production_input_template.py"], {0}),
        (
            "production_dns_readiness",
            [
                "python3",
                "scripts/stage1_production_dns_readiness.py",
                "--production-web-url",
                production_web_url,
                "--staging-web-url",
                staging_web_url,
                "--timeout",
                str(args.timeout),
            ],
            {0, 2},
        ),
        ("validate_production_dns_readiness", ["python3", "scripts/validate_stage1_production_dns_readiness.py"], {0}),
        (
            "production_dns_cutover_plan",
            [
                "python3",
                "scripts/stage1_production_dns_cutover_plan.py",
                "--env",
                env_path,
                "--verify-cloudflare",
            ],
            {0, 2},
        ),
        ("validate_production_dns_cutover_plan", ["python3", "scripts/validate_stage1_production_dns_cutover_plan.py"], {0}),
        (
            "production_proof_bundle",
            [
                "python3",
                "scripts/run_stage1_production_proof_bundle.py",
                "--env",
                env_path,
                "--production-web-url",
                production_web_url,
                "--summary",
                display_path(args.proof_bundle_summary),
                "--pipeline-summary",
                display_path(args.pipeline_summary),
                "--billing-diagnostic",
                display_path(args.billing_diagnostic),
                "--security-diagnostic",
                display_path(args.security_diagnostic),
                "--governance-diagnostic",
                display_path(args.governance_diagnostic),
                "--legal-diagnostic",
                display_path(args.legal_diagnostic),
            ],
            {0, 2},
        ),
        ("validate_production_proof_bundle", ["python3", "scripts/validate_stage1_production_proof_bundle.py"], {0}),
        (
            "validate_production_launch_source_pipeline",
            ["python3", "scripts/validate_stage1_production_launch_source_pipeline.py"],
            {0},
        ),
        (
            "production_billing_operator_packet",
            ["python3", "scripts/generate_stage1_production_billing_operator_packet.py", "--env-file", env_path],
            {0},
        ),
        (
            "validate_production_billing_operator_packet",
            ["python3", "scripts/validate_stage1_production_billing_operator_packet.py"],
            {0},
        ),
        (
            "production_security_operator_packet",
            ["python3", "scripts/generate_stage1_production_security_operator_packet.py"],
            {0},
        ),
        (
            "validate_production_security_operator_packet",
            ["python3", "scripts/validate_stage1_production_security_operator_packet.py"],
            {0},
        ),
        (
            "production_legal_support_operator_packet",
            [
                "python3",
                "scripts/generate_stage1_production_legal_support_operator_packet.py",
                "--production-web-url",
                production_web_url,
            ],
            {0},
        ),
        (
            "validate_production_legal_support_operator_packet",
            ["python3", "scripts/validate_stage1_production_legal_support_operator_packet.py"],
            {0},
        ),
        (
            "production_governance_operator_packet",
            ["python3", "scripts/generate_stage1_production_governance_operator_packet.py"],
            {0},
        ),
        (
            "validate_production_governance_operator_packet",
            ["python3", "scripts/validate_stage1_production_governance_operator_packet.py"],
            {0},
        ),
        ("external_resource_readiness", ["python3", "scripts/generate_stage1_external_resource_readiness.py"], {0}),
        (
            "validate_external_resource_readiness",
            ["python3", "scripts/validate_stage1_external_resource_readiness.py", "--allow-preflight"],
            {0},
        ),
        ("production_launch_input_packet", ["python3", "scripts/generate_stage1_production_launch_input_packet.py"], {0}),
        ("validate_production_launch_input_packet", ["python3", "scripts/validate_stage1_production_launch_input_packet.py"], {0}),
        (
            "production_blocker_audit",
            ["python3", "scripts/generate_stage1_production_blocker_audit.py", "--env-file", env_path],
            {0},
        ),
        ("validate_production_blocker_audit", ["python3", "scripts/validate_stage1_production_blocker_audit.py"], {0}),
        ("production_launch_operator_brief", ["python3", "scripts/generate_stage1_production_launch_operator_brief.py"], {0}),
        (
            "validate_production_launch_operator_brief",
            ["python3", "scripts/validate_stage1_production_launch_operator_brief.py"],
            {0},
        ),
        (
            "production_missing_input_checklist",
            ["python3", "scripts/generate_stage1_production_missing_input_checklist.py"],
            {0},
        ),
        (
            "validate_production_missing_input_checklist",
            ["python3", "scripts/validate_stage1_production_missing_input_checklist.py"],
            {0},
        ),
        (
            "production_source_probe_runbook",
            ["python3", "scripts/generate_stage1_production_source_probe_runbook.py"],
            {0},
        ),
        (
            "validate_production_source_probe_runbook",
            ["python3", "scripts/validate_stage1_production_source_probe_runbook.py"],
            {0},
        ),
        (
            "production_dns_repair_packet",
            [
                "python3",
                "scripts/generate_stage1_production_dns_repair_packet.py",
                "--operator-markdown",
                "ops/evidence/non_clearing/production-dns-operator-checklist.md",
            ],
            {0},
        ),
        (
            "validate_production_dns_repair_packet",
            [
                "python3",
                "scripts/validate_stage1_production_dns_repair_packet.py",
                "--operator-markdown",
                "ops/evidence/non_clearing/production-dns-operator-checklist.md",
            ],
            {0},
        ),
        ("production_blocker_checklist", ["python3", "scripts/generate_stage1_production_blocker_checklist.py"], {0}),
        (
            "validate_production_blocker_checklist",
            ["python3", "scripts/validate_stage1_production_blocker_checklist.py"],
            {0},
        ),
        ("production_action_matrix", ["python3", "scripts/generate_stage1_production_action_matrix.py"], {0}),
        ("validate_production_action_matrix", ["python3", "scripts/validate_stage1_production_action_matrix.py"], {0}),
    ]


def pct(numerator: Any, denominator: Any) -> float:
    if not isinstance(numerator, int) or not isinstance(denominator, int) or denominator <= 0:
        return 0.0
    return round(numerator * 100 / denominator, 1)


def progress_summary() -> dict[str, Any]:
    brief = load_json(DEFAULT_RELEASE_BRIEF)
    checklist = load_json(DEFAULT_MISSING_CHECKLIST)
    runbook = load_json(DEFAULT_SOURCE_RUNBOOK)
    external = load_json(DEFAULT_EXTERNAL_READINESS)
    matrix = load_json(DEFAULT_ACTION_MATRIX)
    next_blockers = load_json(DEFAULT_NEXT_BLOCKERS_SUMMARY)
    closure = load_json(DEFAULT_CLOSURE_QUEUE)

    brief_summary = brief.get("summary") if isinstance(brief.get("summary"), dict) else {}
    checklist_summary = checklist.get("summary") if isinstance(checklist.get("summary"), dict) else {}
    runbook_summary = runbook.get("summary") if isinstance(runbook.get("summary"), dict) else {}
    external_summary = external.get("resource_summary") if isinstance(external.get("resource_summary"), dict) else {}
    next_stage1 = next_blockers.get("stage1") if isinstance(next_blockers.get("stage1"), dict) else {}
    closure_summary = closure.get("queue_summary") if isinstance(closure.get("queue_summary"), dict) else {}
    stage1_summary = next_stage1 or closure_summary

    lanes = []
    for lane in matrix.get("lanes", []) if isinstance(matrix.get("lanes"), list) else []:
        if not isinstance(lane, dict):
            continue
        lanes.append(
            {
                "lane_id": lane.get("lane_id", "unknown"),
                "blocking_input_count": lane.get("blocking_input_count", 0),
                "completion_percent": lane.get("completion_percent", 0),
                "first_blocker": lane.get("first_blocker", "not reported"),
            }
        )

    return {
        "stage1": {
            "completed": stage1_summary.get("completed", brief_summary.get("stage1_gates_completed", 0)),
            "total": stage1_summary.get("total", brief_summary.get("stage1_gates_total", 0)),
            "completion_percent": stage1_summary.get(
                "completion_percent",
                brief_summary.get(
                    "stage1_completion_percent",
                    pct(brief_summary.get("stage1_gates_completed"), brief_summary.get("stage1_gates_total")),
                ),
            ),
            "release_gate_decision": next_blockers.get("release_gate_decision", brief.get("release_gate_decision", "no_go")),
        },
        "external_resources": {
            "ready": external_summary.get("ready", 0),
            "total": external_summary.get("total", 0),
            "ready_percent": external_summary.get("ready_percent", 0),
        },
        "production_inputs": {
            "configured": checklist_summary.get("required_configured", 0),
            "total": checklist_summary.get("required_total", 0),
            "completion_percent": checklist_summary.get("required_completion_percent", 0),
            "missing": checklist_summary.get("required_missing", 0),
            "invalid": checklist_summary.get("required_invalid", 0),
            "blocking_input_count": checklist_summary.get("blocking_input_count", 0),
        },
        "production_source_probes": {
            "ready": runbook_summary.get("ready_to_execute_count", 0),
            "total": runbook_summary.get("runbook_step_count", 0),
            "blocked": runbook_summary.get("blocked_step_count", 0),
            "blocking_input_count": runbook_summary.get("blocking_input_count", 0),
        },
        "production_action_lanes": lanes,
    }


def first_blocker_from_json(path: Path) -> str:
    data = load_json(path)
    blocked_checks = data.get("blocked_checks")
    if isinstance(blocked_checks, list):
        for item in blocked_checks:
            if isinstance(item, str) and item.strip():
                return item.strip()
    summary = data.get("summary") if isinstance(data.get("summary"), dict) else {}
    for key in ("first_blocker", "current_blocker", "blocked_reason", "status"):
        value = summary.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    current_dns = data.get("current_dns_readiness") if isinstance(data.get("current_dns_readiness"), dict) else {}
    value = current_dns.get("first_blocker")
    if isinstance(value, str) and value.strip():
        return value.strip()
    status = data.get("status")
    if isinstance(status, str) and status.strip():
        return f"status={status.strip()}"
    return "blocked evidence did not report a first blocker"


def blocker_detail_for_step(step: dict[str, Any]) -> dict[str, str]:
    step_id = str(step.get("step_id") or "")
    evidence_by_step = {
        "production_dns_readiness": DEFAULT_DNS_READINESS,
        "production_dns_cutover_plan": DEFAULT_DNS_CUTOVER_PLAN,
        "production_proof_bundle": DEFAULT_PROOF_BUNDLE,
    }
    evidence_path = evidence_by_step.get(step_id)
    if evidence_path is None:
        return {
            "step_id": step_id,
            "source": "command_output",
            "detail": scrub(str(step.get("output_summary") or f"exit_{step.get('exit_code')}")),
        }
    return {
        "step_id": step_id,
        "source": display_path(evidence_path),
        "detail": scrub(first_blocker_from_json(evidence_path)),
    }


def build_summary(args: argparse.Namespace, steps: list[dict[str, Any]]) -> dict[str, Any]:
    unexpected = [step for step in steps if step.get("expected_exit") is not True]
    blocked = [step for step in steps if step.get("status") == "blocked"]
    blocked_details = [blocker_detail_for_step(step) for step in blocked]
    data: dict[str, Any] = {
        "schema_version": "stage1.production_non_clearing_refresh.v1",
        "environment": "production",
        "kind": "stage1_production_non_clearing_refresh",
        "status": "failed" if unexpected else ("blocked" if blocked else "pass"),
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "production_web_url": args.production_web_url.rstrip("/"),
        "staging_web_url": args.staging_web_url.rstrip("/"),
        "env_file": display_path(args.env),
        "non_clearing_refresh": True,
        "canonical_sources_requested": False,
        "dns_apply_requested": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "step_summary": {
            "total": len(steps),
            "passed": len([step for step in steps if step.get("status") == "pass"]),
            "blocked": len(blocked),
            "failed": len([step for step in steps if step.get("status") == "failed"]),
            "unexpected_exit_count": len(unexpected),
        },
        "progress": progress_summary(),
        "steps": steps,
        "blocked_checks": [
            f"{detail['step_id']}: {detail['detail']}"
            for detail in blocked_details
        ],
        "blocked_evidence_details": blocked_details,
        "output_refs": {
            "summary": display_path(args.summary),
            "production_launch_operator_brief": display_path(DEFAULT_RELEASE_BRIEF),
            "production_missing_input_checklist": display_path(DEFAULT_MISSING_CHECKLIST),
            "production_source_probe_runbook": display_path(DEFAULT_SOURCE_RUNBOOK),
            "production_action_matrix": display_path(DEFAULT_ACTION_MATRIX),
            "external_resource_readiness": display_path(DEFAULT_EXTERNAL_READINESS),
            "stage1_next_blockers_summary": display_path(DEFAULT_NEXT_BLOCKERS_SUMMARY),
            "release_evidence_closure_queue": display_path(DEFAULT_CLOSURE_QUEUE),
        },
        "gate_impact": {
            "non_clearing_evidence_only": True,
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
            "canonical_source_write_command": "python3 scripts/run_stage1_production_proof_bundle.py --write-canonical-sources",
            "strict_launch_validator": "python3 scripts/validate_stage1_production_launch.py",
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def run_refresh(args: argparse.Namespace) -> int:
    steps: list[dict[str, Any]] = []
    for step_id, command, expected in command_sequence(args):
        step = run_step(step_id, command, expected, step_timeout(step_id, args.timeout))
        steps.append(step)
        if step.get("expected_exit") is not True:
            break
    summary = build_summary(args, steps)
    write_json(args.summary, summary)
    print(f"wrote Stage 1 production non-clearing refresh to {display_path(args.summary)}")
    progress = summary["progress"]
    stage1 = progress["stage1"]
    inputs = progress["production_inputs"]
    print(
        "stage1 "
        f"{stage1['completed']}/{stage1['total']}={stage1['completion_percent']}%; "
        "production_inputs "
        f"{inputs['configured']}/{inputs['total']}={inputs['completion_percent']}%; "
        f"release={stage1['release_gate_decision']}"
    )
    return 1 if summary["status"] == "failed" else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--production-web-url", default=DEFAULT_PRODUCTION_WEB_URL)
    parser.add_argument("--staging-web-url", default=DEFAULT_STAGING_WEB_URL)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--proof-bundle-summary", type=Path, default=DEFAULT_PROOF_BUNDLE)
    parser.add_argument("--pipeline-summary", type=Path, default=DEFAULT_PIPELINE_SUMMARY)
    parser.add_argument("--billing-diagnostic", type=Path, default=DEFAULT_BILLING_DIAGNOSTIC)
    parser.add_argument("--security-diagnostic", type=Path, default=DEFAULT_SECURITY_DIAGNOSTIC)
    parser.add_argument("--governance-diagnostic", type=Path, default=DEFAULT_GOVERNANCE_DIAGNOSTIC)
    parser.add_argument("--legal-diagnostic", type=Path, default=DEFAULT_LEGAL_DIAGNOSTIC)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        step_ids = [step_id for step_id, _command, _expected in command_sequence(args)]
        if step_ids != EXPECTED_STEP_IDS:
            raise SystemExit(
                "stage1 production non-clearing refresh step order mismatch: "
                f"expected {EXPECTED_STEP_IDS}, got {step_ids}"
            )
        flattened = "\n".join(" ".join(command) for _step_id, command, _expected in command_sequence(args))
        if "--write-canonical-sources" in flattened or " --apply" in flattened:
            raise SystemExit("stage1 production non-clearing refresh must not write canonical sources or apply DNS")
        if step_timeout("validate_production_dns_cutover_plan", args.timeout) < 60.0:
            raise SystemExit("stage1 production DNS cutover validator timeout is too low")
        if step_timeout("production_dns_readiness", args.timeout) < 120.0:
            raise SystemExit("stage1 production DNS readiness timeout is too low for DoH and HTTPS probes")
        print("stage1 production non-clearing refresh contract passed")
        return 0
    try:
        return run_refresh(args)
    except ProductionNonClearingRefreshError as exc:
        print(f"stage1 production non-clearing refresh failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
