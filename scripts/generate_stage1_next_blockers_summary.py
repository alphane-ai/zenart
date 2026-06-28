#!/usr/bin/env python3
"""Generate a compact non-clearing Stage 1 next-blockers summary."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.json"
DEFAULT_MARKDOWN = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.md"
DEFAULT_CLOSURE_QUEUE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-evidence-closure-queue.preflight.json"
DEFAULT_ACTION_MATRIX = ROOT / "ops" / "evidence" / "non_clearing" / "production-action-matrix.json"
DEFAULT_MISSING_INPUT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
DEFAULT_LAUNCH_SOURCE_PIPELINE = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-source-pipeline.json"
DEFAULT_NON_CLEARING_REFRESH = ROOT / "ops" / "evidence" / "non_clearing" / "production-non-clearing-refresh.json"
DEFAULT_EXTERNAL_READINESS = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-external-resource-readiness.preflight.json"
DEFAULT_AZURE_READINESS = ROOT / "ops" / "evidence" / "staging" / "stage1-azure-origin-readiness.json"
DEFAULT_RUN_COMMAND_DIAGNOSIS = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-ssh-repair-diagnosis.json"

SAFE_FALSE_FIELDS = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
    "raw_run_command_output_persisted": False,
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
    "stripe-signature",
    "stripe_signature",
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
    "raw_payload",
    "raw_event",
    "raw_response",
    "raw_support_body",
    "raw_output",
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


class NextBlockersSummaryError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise NextBlockersSummaryError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise NextBlockersSummaryError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise NextBlockersSummaryError(f"{display_path(path)} must contain JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise NextBlockersSummaryError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise NextBlockersSummaryError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "stage1_next_blockers_summary")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    assert_no_secret(text, "stage1_next_blockers_markdown")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    value_text = str(value).strip()
    return value_text if value_text else default


def pct(value: Any) -> float:
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return 0.0


def current_loop_breaker_text(external: dict[str, Any], azure: dict[str, Any]) -> str:
    handoff = external.get("operator_handoff") if isinstance(external.get("operator_handoff"), dict) else {}
    loop_breaker = text(handoff.get("current_loop_breaker"), "external readiness loop breaker not reported")
    if azure.get("status") == "pass" and "Azure origin reachability may still be independently blocked" in loop_breaker:
        return (
            "R2, Stripe sandbox, z.ai glm-5.2, staging evidence inputs/artifacts, CI exact artifacts, "
            "and Azure origin are ready; the remaining production loop is source probes: live Stripe billing, "
            "production security, production legal/support HTTPS, and production governance release."
        )
    return loop_breaker


def top_priority_action(
    azure: dict[str, Any],
    diagnosis: dict[str, Any],
    matrix: dict[str, Any],
    external: dict[str, Any],
) -> dict[str, Any]:
    handoff = external.get("operator_handoff") if isinstance(external.get("operator_handoff"), dict) else {}
    resource_status = handoff.get("resource_status") if isinstance(handoff.get("resource_status"), dict) else {}
    diagnosis_findings = [str(item) for item in as_list(diagnosis.get("findings"))]
    azure_blocked = [str(item) for item in as_list(azure.get("blocked_checks"))]
    if azure.get("status") == "pass":
        diagnosis_findings = []
        azure_blocked = []
    if (
        resource_status.get("production_launch_inputs") == "missing"
        and all(
            resource_status.get(key) == "ready"
            for key in ("staging_public_urls", "staging_admin_access", "staging_quota_replay_db", "ci_exact_artifacts")
        )
    ):
        return {
            "action_id": "production_source_probes_missing",
            "lane": "production_launch_inputs",
            "status": "blocked",
            "why": text(
                current_loop_breaker_text(external, azure),
                "Staging, CI, R2, and LLM inputs are ready; production source probes remain missing.",
            ),
            "command": "python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2",
            "requires_external_input": True,
            "external_input": "sanitized live production source evidence for billing, security, legal/support HTTPS, and governance.",
            "parallel_blocker": (
                "staging_origin_parallel_blocker: Azure origin still has SSH/HTTP blockers and Run Command output is missing."
                if "missing_output" in diagnosis_findings
                else "staging_origin_parallel_blocker: Azure origin still has SSH/HTTP blockers."
                if "ssh_connect_timeout" in azure_blocked or "azure_origin_http_no_successful_response" in azure_blocked
                else "none"
            ),
            "parallel_command": (
                "python3 scripts/ingest_azure_run_command_output.py"
                if "missing_output" in diagnosis_findings
                else "scripts/azure_staging_ssh_preflight.sh"
                if "ssh_connect_timeout" in azure_blocked
                else "none"
            ),
        }
    if "missing_output" in diagnosis_findings:
        return {
            "action_id": "azure_run_command_output_missing",
            "lane": "staging_origin",
            "status": "blocked",
            "why": "Azure origin has SSH/HTTP blockers and the VM-internal Run Command output has not been classified yet.",
            "command": "python3 scripts/ingest_azure_run_command_output.py",
            "requires_external_input": True,
            "external_input": "Azure Portal VM Run Command output piped through scripts/ingest_azure_run_command_output.py.",
        }
    if "ssh_connect_timeout" in azure_blocked:
        return {
            "action_id": "azure_ssh_timeout",
            "lane": "staging_origin",
            "status": "blocked",
            "why": "Azure TCP 22 is reachable but SSH auth/banner still times out.",
            "command": "scripts/azure_staging_ssh_preflight.sh",
            "requires_external_input": True,
            "external_input": "VM-internal sshd/socket/firewall repair through Azure Portal or Azure CLI",
        }
    lanes = as_list(matrix.get("lanes"))
    first_lane = lanes[0] if lanes and isinstance(lanes[0], dict) else {}
    return {
        "action_id": text(first_lane.get("lane_id"), "production_inputs"),
        "lane": text(first_lane.get("lane_id"), "production"),
        "status": "blocked",
        "why": text(first_lane.get("first_blocker"), "production evidence is still missing"),
        "command": lane_top_action_command(first_lane),
        "requires_external_input": True,
        "external_input": "production proof inputs and source evidence",
    }


def production_source_input_rows(pipeline: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for item in as_list(pipeline.get("missing_source_inputs")):
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "source_step_id": text(item.get("source_step_id"), "unknown"),
                "probe_id": text(item.get("probe_id"), "unknown"),
                "coverage_group": text(item.get("coverage_group"), "unknown"),
                "status": text(item.get("status"), "blocked"),
                "blocking_input_count": int(item.get("blocking_input_count", 0) or 0),
                "required_configured": int(item.get("required_configured", 0) or 0),
                "required_total": int(item.get("required_total", 0) or 0),
                "completion_percent": pct(item.get("completion_percent", 0)),
                "candidate_proof_path": item.get("candidate_proof_path"),
                "candidate_proof_exists": item.get("candidate_proof_exists"),
                "canonical_source_path": text(item.get("canonical_source_path"), "unknown"),
                "strict_validator": text(item.get("strict_validator"), "unknown"),
                "first_blocker": text(item.get("first_blocker"), "not reported"),
                "missing_or_invalid_inputs": [str(value) for value in as_list(item.get("missing_or_invalid_inputs"))],
                "operator_next_action": text(item.get("operator_next_action"), "not reported"),
            }
        )
    return rows


def first_command(value: Any, default: str = "not reported") -> str:
    commands = [str(item).strip() for item in as_list(value) if str(item).strip()]
    return commands[0] if commands else default


def lane_top_action_command(lane: dict[str, Any]) -> str:
    lane_id = text(lane.get("lane_id"))
    first_blocker = text(lane.get("first_blocker")).lower()
    if lane_id == "production_dns_https" and (
        "resolver" in first_blocker or "dns" in first_blocker or "zenari.ai" in first_blocker
    ):
        return first_command(
            lane.get("automation_commands"),
            "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
        )
    source_probe_command = text(lane.get("source_probe_command"))
    if source_probe_command:
        return source_probe_command
    return first_command(
        lane.get("automation_commands"),
        "python3 scripts/generate_stage1_production_missing_input_checklist.py",
    )


def operator_shortlist(
    azure: dict[str, Any],
    diagnosis: dict[str, Any],
    matrix: dict[str, Any],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    lanes = [lane for lane in as_list(matrix.get("lanes")) if isinstance(lane, dict)]
    for lane in lanes[:4]:
        rows.append(
            {
                "order": int(lane.get("order", len(rows) + 1) or len(rows) + 1),
                "item_id": text(lane.get("lane_id"), "unknown"),
                "lane": text(lane.get("title"), text(lane.get("lane_id"), "production")),
                "status": text(lane.get("status"), "blocked"),
                "requires_external_input": True,
                "current_blocker": text(lane.get("first_blocker"), "not reported"),
                "operator_action": text(lane.get("immediate_action"), "not reported"),
                "agent_action_after_input": text(lane.get("agent_action_after_inputs"), "not reported"),
                "command": first_command(lane.get("automation_commands")),
                "evidence_ref": text(lane.get("operator_packet_ref") or lane.get("source_output_path"), "not reported"),
                "gate_impact": "non_clearing_operator_shortlist_only",
                "can_clear_stage1_staging_runtime_gate": False,
                "can_clear_stage1_production_launch_gate": False,
                "can_close_do_not_launch": False,
            }
        )

    diagnosis_findings = [str(item) for item in as_list(diagnosis.get("findings"))]
    azure_blocked = [str(item) for item in as_list(azure.get("blocked_checks"))]
    transport = azure.get("transport_diagnosis") if isinstance(azure.get("transport_diagnosis"), dict) else {}
    if azure.get("status") == "pass":
        diagnosis_findings = []
        azure_blocked = []
    azure_needs_run_command = bool(transport.get("azure_portal_run_command_required")) or "missing_output" in diagnosis_findings
    if azure_needs_run_command or "ssh_connect_timeout" in azure_blocked or "azure_origin_http_no_successful_response" in azure_blocked:
        rows.append(
            {
                "order": len(rows) + 1,
                "item_id": "azure_run_command_output_missing",
                "lane": "Staging Azure origin parallel repair",
                "status": text(azure.get("status"), "blocked"),
                "requires_external_input": True,
                "current_blocker": text(
                    transport.get("operator_summary"),
                    "Azure origin SSH/HTTP probes are blocked and Run Command output is missing.",
                ),
                "operator_action": "Run the Azure Portal VM RunShellScript payload, then save the non-secret output for local ingest.",
                "agent_action_after_input": "Sanitize/classify Run Command output, refresh Azure origin readiness, and refresh next-blockers evidence.",
                "command": "python3 scripts/ingest_azure_run_command_output.py",
                "evidence_ref": "ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json",
                "gate_impact": "non_clearing_parallel_ops_only",
                "can_clear_stage1_staging_runtime_gate": False,
                "can_clear_stage1_production_launch_gate": False,
                "can_close_do_not_launch": False,
            }
        )

    return rows[:5]


def action_owner(item: dict[str, Any]) -> str:
    item_id = text(item.get("item_id"), "unknown")
    if item_id == "azure_run_command_output_missing":
        return "operator_azure_portal"
    if item_id == "production_dns_https":
        return "operator_cloudflare_dns"
    return "operator_production_account"


def required_return_artifact(item: dict[str, Any]) -> str:
    item_id = text(item.get("item_id"), "unknown")
    if item_id == "azure_run_command_output_missing":
        return "sanitized Azure Portal RunShellScript output containing zenari_azure_run_command_payload=complete, pasted into python3 scripts/ingest_azure_run_command_output.py stdin"
    if item_id == "production_dns_https":
        return "Cloudflare DNS Edit token/Zone ID plus PRODUCTION_DNS_TARGET in a private env file, or manual apex/www DNS records with HTTPS resolver proof"
    if item_id == "production_live_billing":
        return "sanitized Stripe live IDs and production audit refs for checkout, subscription, invoice, refund, quota, webhook, and team-seat lifecycle"
    if item_id == "production_security_runtime":
        return "production runtime request/audit refs for session cookie, CSRF, redaction, admin privacy, key containment, CSP, RBAC, audit, rate limit, and spend cap"
    if item_id == "production_governance_release":
        return "production activation, abuse, and skill release runtime request IDs plus immutable audit refs"
    return "sanitized production source evidence matching the operator packet"


def agent_command_after_return(item: dict[str, Any]) -> str:
    item_id = text(item.get("item_id"), "unknown")
    if item_id == "azure_run_command_output_missing":
        return "python3 scripts/ingest_azure_run_command_output.py"
    if item_id == "production_dns_https":
        return "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json"
    if item_id == "production_live_billing":
        return "python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2"
    if item_id == "production_security_runtime":
        return "python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2"
    if item_id == "production_governance_release":
        return "python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2"
    return text(item.get("command"), "python3 scripts/generate_stage1_next_blockers_summary.py")


def validation_after_return(item: dict[str, Any]) -> str:
    item_id = text(item.get("item_id"), "unknown")
    if item_id == "azure_run_command_output_missing":
        return "python3 scripts/validate_stage1_azure_origin_readiness.py && python3 scripts/validate_stage1_next_blockers_summary.py"
    if item_id == "production_dns_https":
        return "python3 scripts/stage1_production_dns_readiness.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-readiness.json || test $? -eq 2"
    return "python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2"


def blind_handoff_note(item: dict[str, Any]) -> str:
    item_id = text(item.get("item_id"), "unknown")
    if item_id == "azure_run_command_output_missing":
        return "This is the only current Azure VM step: run the existing payload inside the 52.237.80.117 VM through Azure Portal Run Command or Serial Console, then paste the non-secret output back for ingest."
    if item_id == "production_dns_https":
        return "Do not paste R2 S3 credentials here; DNS needs Cloudflare DNS permission or manual DNS records, then resolver/HTTPS proof."
    if item_id == "production_live_billing":
        return "Stripe sandbox evidence is already non-blocking; only live-mode sanitized proof can advance this item."
    return "Provide sanitized production runtime/audit references only; do not paste secrets, cookies, Authorization headers, signed URLs, or raw provider payloads."


def operator_action_packet(shortlist: list[dict[str, Any]], action: dict[str, Any]) -> list[dict[str, Any]]:
    packet: list[dict[str, Any]] = []
    for item in shortlist:
        item_id = text(item.get("item_id"), "unknown")
        packet.append(
            {
                "order": int(item.get("order", len(packet) + 1) or len(packet) + 1),
                "item_id": item_id,
                "owner": action_owner(item),
                "status": text(item.get("status"), "blocked"),
                "requires_external_input": bool(item.get("requires_external_input", True)),
                "required_return_artifact": required_return_artifact(item),
                "agent_command_after_return": agent_command_after_return(item),
                "validation_after_return": validation_after_return(item),
                "blind_handoff_note": blind_handoff_note(item),
                "evidence_ref": text(item.get("evidence_ref"), "not reported"),
                "gate_impact": text(item.get("gate_impact"), "non_clearing_operator_shortlist_only"),
                "can_clear_stage1_staging_runtime_gate": False,
                "can_clear_stage1_production_launch_gate": False,
                "can_close_do_not_launch": False,
            }
        )
    if action.get("action_id") not in {row["item_id"] for row in packet}:
        packet.insert(
            0,
            {
                "order": 0,
                "item_id": text(action.get("action_id"), "top_priority_action"),
                "owner": "agent_after_operator_input" if action.get("requires_external_input") else "agent_local",
                "status": text(action.get("status"), "blocked"),
                "requires_external_input": bool(action.get("requires_external_input")),
                "required_return_artifact": text(action.get("external_input"), "none"),
                "agent_command_after_return": text(action.get("command"), "not reported"),
                "validation_after_return": "python3 scripts/validate_stage1_next_blockers_summary.py",
                "blind_handoff_note": text(action.get("why"), "top priority action"),
                "evidence_ref": "ops/evidence/non_clearing/stage1-next-blockers-summary.json",
                "gate_impact": "non_clearing_operator_shortlist_only",
                "can_clear_stage1_staging_runtime_gate": False,
                "can_clear_stage1_production_launch_gate": False,
                "can_close_do_not_launch": False,
            },
        )
    return packet[:6]


def projected_run_command_diagnosis(azure: dict[str, Any], diagnosis: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    source_status = text(diagnosis.get("status"), "missing")
    source_findings = [str(item) for item in as_list(diagnosis.get("findings"))]
    source_origin_summary = {
        str(key): str(value)
        for key, value in (diagnosis.get("origin_summary") if isinstance(diagnosis.get("origin_summary"), dict) else {}).items()
    }
    if azure.get("status") == "pass":
        return {
            "status": "superseded",
            "source_status": source_status,
            "superseded_by": "azure_origin_pass",
            "ssh_repair_status": "not_required",
            "origin_runtime_status": "not_required",
            "next_repair_lane": "none",
            "findings": [],
            "source_findings": source_findings,
            "input_present": bool(diagnosis.get("input_present")),
            "raw_output_persisted": bool(diagnosis.get("raw_output_persisted")),
            "origin_summary": source_origin_summary,
            "output_path": text(diagnosis.get("output_path"), display_path(args.run_command_diagnosis)),
        }
    return {
        "status": source_status,
        "source_status": source_status,
        "superseded_by": "none",
        "ssh_repair_status": text(diagnosis.get("ssh_repair_status"), "missing"),
        "origin_runtime_status": text(diagnosis.get("origin_runtime_status"), "missing"),
        "next_repair_lane": text(diagnosis.get("next_repair_lane"), "unknown"),
        "findings": source_findings,
        "source_findings": source_findings,
        "input_present": bool(diagnosis.get("input_present")),
        "raw_output_persisted": bool(diagnosis.get("raw_output_persisted")),
        "origin_summary": source_origin_summary,
        "output_path": text(diagnosis.get("output_path"), display_path(args.run_command_diagnosis)),
    }


def build_summary(args: argparse.Namespace) -> dict[str, Any]:
    closure = load_json(args.closure_queue)
    matrix = load_json(args.action_matrix)
    missing = load_json(args.missing_input_checklist)
    source = load_json(args.source_runbook)
    pipeline = load_json(args.launch_source_pipeline)
    refresh = load_json(args.non_clearing_refresh)
    external = load_json(args.external_readiness)
    azure = load_json(args.azure_readiness)
    diagnosis = load_json(args.run_command_diagnosis)

    queue = closure.get("queue_summary") if isinstance(closure.get("queue_summary"), dict) else {}
    matrix_summary = matrix.get("summary") if isinstance(matrix.get("summary"), dict) else {}
    missing_summary = missing.get("summary") if isinstance(missing.get("summary"), dict) else {}
    source_summary = source.get("summary") if isinstance(source.get("summary"), dict) else {}
    refresh_summary = refresh.get("step_summary") if isinstance(refresh.get("step_summary"), dict) else {}
    external_summary = external.get("resource_summary") if isinstance(external.get("resource_summary"), dict) else {}
    lanes = [lane for lane in as_list(matrix.get("lanes")) if isinstance(lane, dict)]

    stage1_completed = int(queue.get("completed", matrix_summary.get("stage1_gates_completed", 0)) or 0)
    stage1_total = int(queue.get("total", matrix_summary.get("stage1_gates_total", 0)) or 0)
    open_gates = [str(item) for item in as_list(queue.get("open_gates"))]
    azure_commands = [str(item) for item in as_list(azure.get("origin_repair_commands"))]
    http_failures = sorted({str(row.get("failure_category")) for row in as_list(azure.get("http_probes")) if isinstance(row, dict)})
    transport = azure.get("transport_diagnosis") if isinstance(azure.get("transport_diagnosis"), dict) else {}

    shortlist = operator_shortlist(azure, diagnosis, matrix)
    top_action = top_priority_action(azure, diagnosis, matrix, external)
    run_command_diagnosis = projected_run_command_diagnosis(azure, diagnosis, args)

    data: dict[str, Any] = {
        "schema_version": "stage1.next_blockers_summary.v1",
        "kind": "stage1_next_blockers_summary",
        "environment": "non_clearing",
        "generated_at": now(),
        "status": "blocked" if open_gates else "pass",
        "release_gate_decision": "no_go",
        "canonical_pass_path": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "stage1": {
            "completed": stage1_completed,
            "total": stage1_total,
            "completion_percent": pct(queue.get("completion_percent", matrix_summary.get("stage1_completion_percent", 0))),
            "open": int(queue.get("open", len(open_gates)) or 0),
            "open_gates": open_gates,
        },
        "production_inputs": {
            "configured": int(missing_summary.get("required_configured", matrix_summary.get("production_inputs_configured", 0)) or 0),
            "total": int(missing_summary.get("required_total", matrix_summary.get("production_inputs_total", 0)) or 0),
            "completion_percent": pct(missing_summary.get("required_completion_percent", matrix_summary.get("production_inputs_completion_percent", 0))),
            "missing": int(missing_summary.get("required_missing", matrix_summary.get("production_inputs_missing", 0)) or 0),
            "invalid": int(missing_summary.get("required_invalid", matrix_summary.get("production_inputs_invalid", 0)) or 0),
            "blocking_input_count": int(missing_summary.get("blocking_input_count", matrix_summary.get("blocking_input_count", 0)) or 0),
        },
        "production_source_probes": {
            "ready": int(source_summary.get("ready_to_execute_count", matrix_summary.get("source_probes_ready", 0)) or 0),
            "total": int(source_summary.get("runbook_step_count", matrix_summary.get("source_probes_total", 0)) or 0),
            "blocked": int(source_summary.get("blocked_step_count", matrix_summary.get("source_probes_blocked", 0)) or 0),
            "blocking_input_count": int(source_summary.get("blocking_input_count", 0) or 0),
        },
        "production_source_inputs": production_source_input_rows(pipeline),
        "non_clearing_refresh": {
            "passed": int(refresh_summary.get("passed", 0) or 0),
            "total": int(refresh_summary.get("total", 0) or 0),
            "blocked": int(refresh_summary.get("blocked", 0) or 0),
            "failed": int(refresh_summary.get("failed", 0) or 0),
        },
        "external_resource_readiness": {
            "ready": int(external_summary.get("ready", 0) or 0),
            "total": int(external_summary.get("total", 0) or 0),
            "ready_percent": pct(external_summary.get("ready_percent", 0)),
            "missing": int(external_summary.get("missing", 0) or 0),
            "blocked": int(external_summary.get("blocked", 0) or 0),
            "provided_unverified": int(external_summary.get("provided_unverified", 0) or 0),
            "current_loop_breaker": current_loop_breaker_text(external, azure),
        },
        "azure_origin": {
            "status": text(azure.get("status"), "missing"),
            "release_gate_decision": text(azure.get("release_gate_decision"), "no_go"),
            "blocked_checks": [str(item) for item in as_list(azure.get("blocked_checks"))],
            "http_passed": sum(1 for row in as_list(azure.get("http_probes")) if isinstance(row, dict) and row.get("status") == "pass"),
            "http_total": len(as_list(azure.get("http_probes"))),
            "http_failure_categories": http_failures,
            "tcp_passed": sum(1 for row in as_list(azure.get("tcp_ports")) if isinstance(row, dict) and row.get("status") == "pass"),
            "tcp_total": len(as_list(azure.get("tcp_ports"))),
            "ssh_status": text((azure.get("ssh_key_preflight") or {}).get("status") if isinstance(azure.get("ssh_key_preflight"), dict) else "", "missing"),
            "ssh_reason": text((azure.get("ssh_key_preflight") or {}).get("reason") if isinstance(azure.get("ssh_key_preflight"), dict) else "", "missing"),
            "azure_cli_status": text((azure.get("azure_cli_preflight") or {}).get("status") if isinstance(azure.get("azure_cli_preflight"), dict) else "", "missing"),
            "azure_cli_reason": text((azure.get("azure_cli_preflight") or {}).get("reason") if isinstance(azure.get("azure_cli_preflight"), dict) else "", "missing"),
            "transport_lane": text(transport.get("lane"), "missing"),
            "transport_next_action": text(transport.get("next_action"), "missing"),
            "transport_summary": text(transport.get("operator_summary"), "missing"),
            "transport_blocked_reasons": [str(item) for item in as_list(transport.get("blocked_reasons"))],
            "ssh_transport_phase": text(transport.get("ssh_transport_phase"), "missing"),
            "ssh_password_key_repair_viable": bool(transport.get("ssh_password_key_repair_viable")),
            "azure_portal_run_command_required": bool(transport.get("azure_portal_run_command_required")),
            "http_response_started": bool(transport.get("http_response_started")),
            "repair_command_count": len(azure_commands),
            "repair_commands": azure_commands,
        },
        "azure_run_command_diagnosis": run_command_diagnosis,
        "production_lanes": [
            {
                "lane_id": text(lane.get("lane_id"), "unknown"),
                "blocking_input_count": int(lane.get("blocking_input_count", 0) or 0),
                "completion_percent": pct(lane.get("completion_percent", 0)),
                "first_blocker": text(lane.get("first_blocker"), "not reported"),
            }
            for lane in lanes
        ],
        "operator_shortlist": shortlist,
        "operator_action_packet": operator_action_packet(shortlist, top_action),
        "top_priority_action": top_action,
        "evidence_refs": {
            "closure_queue": display_path(args.closure_queue),
            "production_action_matrix": display_path(args.action_matrix),
            "production_missing_input_checklist": display_path(args.missing_input_checklist),
            "production_source_probe_runbook": display_path(args.source_runbook),
            "production_launch_source_pipeline": display_path(args.launch_source_pipeline),
            "production_non_clearing_refresh": display_path(args.non_clearing_refresh),
            "external_resource_readiness": display_path(args.external_readiness),
            "azure_origin_readiness": display_path(args.azure_readiness),
            "azure_run_command_diagnosis": display_path(args.run_command_diagnosis),
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def render_markdown(data: dict[str, Any]) -> str:
    stage1 = data["stage1"]
    inputs = data["production_inputs"]
    probes = data["production_source_probes"]
    source_inputs = data["production_source_inputs"]
    refresh = data["non_clearing_refresh"]
    external = data["external_resource_readiness"]
    azure = data["azure_origin"]
    diagnosis = data["azure_run_command_diagnosis"]
    action = data["top_priority_action"]
    shortlist = data["operator_shortlist"]
    action_packet = data["operator_action_packet"]
    lines = [
        "# Stage 1 Next Blockers Summary",
        "",
        "This is a non-clearing operator summary. It preserves `no_go` and does not close staging, production, or Do-Not-Launch gates.",
        "",
        "## Counts",
        "",
        "| Area | Count | Percent | Status |",
        "| --- | ---: | ---: | --- |",
        f"| Stage1 gates | {stage1['completed']}/{stage1['total']} | {stage1['completion_percent']}% | {data['release_gate_decision']} |",
        f"| Production inputs | {inputs['configured']}/{inputs['total']} | {inputs['completion_percent']}% | {inputs['blocking_input_count']} blockers |",
        f"| Production source probes | {probes['ready']}/{probes['total']} | 0.0% | {probes['blocked']} blocked |",
        f"| External resources | {external['ready']}/{external['total']} | {external['ready_percent']}% | {external['missing']} missing / {external['blocked']} blocked |",
        f"| Non-clearing refresh | {refresh['passed']}/{refresh['total']} | {round((refresh['passed'] / refresh['total'] * 100) if refresh['total'] else 0, 1)}% | {refresh['blocked']} blocked / {refresh['failed']} failed |",
        f"| Azure TCP ports | {azure['tcp_passed']}/{azure['tcp_total']} | {round((azure['tcp_passed'] / azure['tcp_total'] * 100) if azure['tcp_total'] else 0, 1)}% | public entry ports 22/80/443 |",
        f"| Azure HTTP probes | {azure['http_passed']}/{azure['http_total']} | {round((azure['http_passed'] / azure['http_total'] * 100) if azure['http_total'] else 0, 1)}% | {', '.join(azure['blocked_checks']) or 'none'} |",
        "",
        "## External Resources",
        "",
        f"- External readiness: `{external['ready']}/{external['total']} = {external['ready_percent']}%`",
        f"- Current loop breaker: {external['current_loop_breaker']}",
        "",
        "## Azure",
        "",
        f"- Azure status: `{azure['status']} / {azure['release_gate_decision']}`",
        f"- SSH: `{azure['ssh_status']} / {azure['ssh_reason']}`",
        f"- Azure CLI: `{azure['azure_cli_status']} / {azure['azure_cli_reason']}`",
        f"- Transport lane: `{azure['transport_lane']}` next `{azure['transport_next_action']}`",
        f"- Transport summary: {azure['transport_summary']}",
        f"- Transport reasons: `{', '.join(azure['transport_blocked_reasons']) or 'none'}`",
        f"- SSH phase: `{azure['ssh_transport_phase']}`; password/key repair viable `{azure['ssh_password_key_repair_viable']}`; Run Command required `{azure['azure_portal_run_command_required']}`",
        f"- HTTP failure categories: `{', '.join(azure['http_failure_categories']) or 'none'}`",
        f"- Repair commands: `{azure['repair_command_count']}`",
        f"- Run Command diagnosis: `{diagnosis['status']}` source `{diagnosis['source_status']}` superseded_by `{diagnosis['superseded_by']}` findings `{', '.join(diagnosis['findings']) or 'none'}` input_present `{diagnosis['input_present']}`",
        f"- Run Command lanes: SSH repair `{diagnosis['ssh_repair_status']}`, origin runtime `{diagnosis['origin_runtime_status']}`, next `{diagnosis['next_repair_lane']}`",
        f"- Origin summary keys: `{', '.join(sorted(diagnosis.get('origin_summary', {}).keys())) or 'none'}`",
        "",
        "## Operator Shortlist",
        "",
        "| # | Item | Status | Needs Input | Current Blocker | Operator Action | Agent Command |",
        "| ---: | --- | --- | --- | --- | --- | --- |",
    ]
    for item in shortlist:
        lines.append(
            "| "
            f"{item['order']} | "
            f"{item['item_id']} | "
            f"{item['status']} | "
            f"{item['requires_external_input']} | "
            f"{item['current_blocker']} | "
            f"{item['operator_action']} | "
            f"`{item['command']}` |"
        )
    lines.extend(
        [
            "",
            "## Operator Action Packet",
            "",
            "| # | Item | Owner | Return Artifact | Agent Command After Return | Validation |",
            "| ---: | --- | --- | --- | --- | --- |",
        ]
    )
    for item in action_packet:
        lines.append(
            "| "
            f"{item['order']} | "
            f"{item['item_id']} | "
            f"{item['owner']} | "
            f"{item['required_return_artifact']} | "
            f"`{item['agent_command_after_return']}` | "
            f"`{item['validation_after_return']}` |"
        )
        lines.append(f"<!-- {item['item_id']} handoff: {item['blind_handoff_note']} -->")
    lines.extend(
        [
            "",
        "## Production Lanes",
        "",
        "| Lane | Blockers | Percent | First Blocker |",
        "| --- | ---: | ---: | --- |",
        ]
    )
    for lane in data["production_lanes"]:
        lines.append(f"| {lane['lane_id']} | {lane['blocking_input_count']} | {lane['completion_percent']}% | {lane['first_blocker']} |")
    lines.extend(
        [
            "",
            "## Production Source Inputs",
            "",
            "| Source Step | Inputs | Percent | Candidate Proof | Canonical Source | First Blocker |",
            "| --- | ---: | ---: | --- | --- | --- |",
        ]
    )
    for row in source_inputs:
        candidate = row["candidate_proof_path"] or "HTTPS production pages"
        lines.append(
            "| "
            f"{row['source_step_id']} | "
            f"{row['required_configured']}/{row['required_total']} | "
            f"{row['completion_percent']}% | "
            f"{candidate} | "
            f"{row['canonical_source_path']} | "
            f"{row['first_blocker']} |"
        )
    lines.extend(
        [
            "",
            "## Top Priority Action",
            "",
            f"- Action: `{action['action_id']}`",
            f"- Lane: `{action['lane']}`",
            f"- Why: {action['why']}",
            f"- Requires external input: `{action['requires_external_input']}`",
            f"- External input: {action['external_input']}",
            f"- Parallel blocker: {action.get('parallel_blocker', 'none')}",
            f"- Parallel command: `{action.get('parallel_command', 'none')}`",
            "",
            "```bash",
            action["command"],
            "```",
            "",
            "## Evidence Refs",
            "",
        ]
    )
    for key, value in data["evidence_refs"].items():
        lines.append(f"- `{key}`: `{value}`")
    lines.append("")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--markdown", type=Path, default=DEFAULT_MARKDOWN)
    parser.add_argument("--closure-queue", type=Path, default=DEFAULT_CLOSURE_QUEUE)
    parser.add_argument("--action-matrix", type=Path, default=DEFAULT_ACTION_MATRIX)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_MISSING_INPUT_CHECKLIST)
    parser.add_argument("--source-runbook", type=Path, default=DEFAULT_SOURCE_RUNBOOK)
    parser.add_argument("--launch-source-pipeline", type=Path, default=DEFAULT_LAUNCH_SOURCE_PIPELINE)
    parser.add_argument("--non-clearing-refresh", type=Path, default=DEFAULT_NON_CLEARING_REFRESH)
    parser.add_argument("--external-readiness", type=Path, default=DEFAULT_EXTERNAL_READINESS)
    parser.add_argument("--azure-readiness", type=Path, default=DEFAULT_AZURE_READINESS)
    parser.add_argument("--run-command-diagnosis", type=Path, default=DEFAULT_RUN_COMMAND_DIAGNOSIS)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        source = Path(__file__).read_text(encoding="utf-8")
        for snippet in (
            "stage1.next_blockers_summary.v1",
            "azure_run_command_output.py",
            "azure_run_command_diagnosis",
            "production_lanes",
            "production_source_inputs",
            "external_resource_readiness",
            "production_source_probes_missing",
            "top_priority_action",
            "operator_shortlist",
            "operator_action_packet",
            "blind_handoff_note",
            "required_return_artifact",
            "agent_command_after_return",
            "azure_run_command_output_missing",
            "non_clearing_operator_shortlist_only",
            "missing_output",
            "raw_run_command_output_persisted",
            "can_clear_stage1_production_launch_gate",
        ):
            if snippet not in source:
                raise SystemExit(f"missing contract snippet: {snippet}")
        print("stage1 next blockers summary generator contract passed")
        return 0
    data = build_summary(args)
    write_json(args.output, data)
    write_text(args.markdown, render_markdown(data))
    print(f"wrote Stage 1 next blockers summary to {display_path(args.output)}")
    print(f"wrote Stage 1 next blockers markdown to {display_path(args.markdown)}")
    return 0 if data["status"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
