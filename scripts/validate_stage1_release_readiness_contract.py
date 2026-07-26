#!/usr/bin/env python3
"""Validate Stage 1 AD-14 release readiness admin contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "release_readiness" / "local_contract.json"
ADMIN_PAGE = ROOT / "admin" / "app" / "release" / "page.tsx"
ADMIN_SHELL = ROOT / "admin" / "components" / "AdminShell.tsx"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_TESTS = ROOT / "admin" / "tests" / "admin-data.test.mjs"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
PRODUCTION_ACTION_MATRIX = ROOT / "ops" / "evidence" / "non_clearing" / "production-action-matrix.json"
NEXT_BLOCKERS_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.json"
RELEASE_EVIDENCE_CLOSURE_QUEUE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-evidence-closure-queue.preflight.json"
PRODUCTION_OPERATOR_PACKET_PATHS = {
    "billing": ROOT / "ops" / "evidence" / "non_clearing" / "production-billing-operator-packet.json",
    "security": ROOT / "ops" / "evidence" / "non_clearing" / "production-security-operator-packet.json",
    "legal_support": ROOT / "ops" / "evidence" / "non_clearing" / "production-legal-support-operator-packet.json",
    "governance": ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-operator-packet.json",
}

SAFE_FALSE_FIELDS = (
    "authorization_header_persisted",
    "can_clear_stage1_production_launch_gate",
    "can_close_do_not_launch",
    "canonical_pass_path",
    "cookie_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "secret_material_persisted",
    "signed_url_persisted",
)

COPY_SAFE_COMMAND_LANES = (
    "refresh",
    "refresh_validate",
    "dns_plan",
    "dns_readiness",
    "dns_repair_packet",
    "private_env_template",
    "proof_bundle_private_env",
    "proof_bundle_validate",
    "launch_input_packet",
)

COPY_SAFE_COMMAND_SNIPPETS = (
    "refresh.generatorCommand",
    "refresh.validatorCommand",
    "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
    "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json || test $? -eq 2",
    "python3 scripts/generate_stage1_production_dns_repair_packet.py --operator-markdown ops/evidence/non_clearing/production-dns-operator-checklist.md",
    "inputTemplate.generatorCommand",
    "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
    "proofBundle.strictValidator",
    "python3 scripts/generate_stage1_production_launch_input_packet.py",
)

ACTION_MATRIX_LOOP_BREAKERS = (
    "staging aggregate is already go",
    "R2 zenari bucket is already a staging resource, not the current production blocker",
    "Stripe sandbox is not the current blocker; live mode proof is required",
    "z.ai/OpenAI-compatible LLM is not the current blocker",
    "worker/crawler/migrate are backend runtime entrypoints, not release images",
    "manager is legacy local-only and not a release surface",
)

ACTION_MATRIX_HELP_ASKS = (
    "Provide PRODUCTION_DNS_TARGET plus Cloudflare zone/token, or apply the apex/www records manually.",
    "Use live Stripe mode and collect sanitized live checkout, subscription, invoice, refund, quota, and webhook IDs.",
    "Attach production runtime refs for session cookie, CSRF, redaction, admin privacy, key containment, CSP, RBAC, audit, and spend caps.",
    "Provide activation, abuse, and skill release runtime request IDs plus immutable production audit refs.",
)

AZURE_RUN_COMMAND_SNIPPETS = (
    "AzureRunCommandHandoffRow",
    "azureRunCommandHandoffRows",
    'data-azure-run-command-handoff="operator-card-derived"',
    "data-azure-run-command-operator-card",
    "data-azure-run-command-payload",
    "data-azure-run-command-ingest",
    "data-azure-run-command-password-key-repair-viable",
    "data-azure-run-command-required",
    "ops/evidence/staging/azure-run-command-operator-card.md",
    "ops/evidence/staging/azure-run-command-ssh-repair.sh",
    "python3 scripts/ingest_azure_run_command_output.py",
    "RunShellScript",
    "local repo stdin",
    "raw output is sanitized",
    "transport first",
)

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class ReleaseReadinessContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ReleaseReadinessContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise ReleaseReadinessContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    return data


def extract_function_body(text: str, function_name: str) -> str:
    marker = f"function {function_name}"
    start = text.find(marker)
    require(start >= 0, f"admin release page missing function {function_name}")

    paren_start = text.find("(", start)
    require(paren_start >= 0, f"admin release page missing signature for function {function_name}")
    paren_depth = 0
    signature_end = -1
    for index in range(paren_start, len(text)):
        if text[index] == "(":
            paren_depth += 1
        elif text[index] == ")":
            paren_depth -= 1
            if paren_depth == 0:
                signature_end = index
                break
    require(signature_end >= 0, f"admin release page has unterminated signature for function {function_name}")

    brace_start = text.find("{", signature_end)
    require(brace_start >= 0, f"admin release page missing body for function {function_name}")

    depth = 0
    for index in range(brace_start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[brace_start : index + 1]
    raise ReleaseReadinessContractError(f"admin release page has unterminated function {function_name}")


def validate_copy_safe_command_contract(page: str) -> None:
    require("ProductionCopySafeCommandRow" in page, "release page missing copy-safe command row type")
    require("productionCopySafeCommandRows" in page, "release page missing copy-safe command row builder")
    require("ProductionCopySafeCommandListPanel" in page, "release page missing copy-safe command panel")
    require('data-production-copy-safe-commands="operator-handoff"' in page, "copy-safe panel missing operator handoff anchor")
    require("data-production-copy-safe-commands-non-clearing" in page, "copy-safe panel missing non-clearing anchor")
    require(
        'data-production-copy-safe-commands-private-env="<private-production-env>"' in page,
        "copy-safe panel must use private env placeholder",
    )
    require(
        'data-production-copy-safe-commands-exec-controls="absent"' in page,
        "copy-safe panel must declare absent execution controls",
    )
    require("copy-safe list does not include --apply" in page, "copy-safe panel must explain DNS apply exclusion")
    require("<private-production-env>" in page, "copy-safe panel must render private env placeholder")

    builder_body = extract_function_body(page, "productionCopySafeCommandRows")
    lanes = re.findall(r'\blane:\s*"([^"]+)"', builder_body)
    require(tuple(lanes) == COPY_SAFE_COMMAND_LANES, f"copy-safe command lanes mismatch: {lanes!r}")
    for snippet in COPY_SAFE_COMMAND_SNIPPETS:
        require(snippet in builder_body, f"copy-safe command builder missing {snippet!r}")
    require("--apply" not in builder_body, "copy-safe command builder must not include DNS --apply")
    require(not RAW_SECRET_RE.search(builder_body), "copy-safe command builder contains raw secret-looking material")
    require("rawProviderPayload" not in builder_body, "copy-safe commands must not reference raw provider payloads")
    require("Authorization" not in builder_body, "copy-safe commands must not render authorization headers")
    require("Cookie" not in builder_body, "copy-safe commands must not render cookies")

    panel_body = extract_function_body(page, "ProductionCopySafeCommandListPanel")
    for forbidden in ("<button", "<form", 'type="submit"', "onClick=", "href=", "window.", "fetch("):
        require(forbidden not in panel_body, f"copy-safe command panel must not expose execution control {forbidden!r}")
    require("DataTable<ProductionCopySafeCommandRow>" in panel_body, "copy-safe commands must render as table text")
    require(not RAW_SECRET_RE.search(panel_body), "copy-safe command panel contains raw secret-looking material")


def validate_action_matrix_handoff_contract(page: str) -> None:
    data = load_json(PRODUCTION_ACTION_MATRIX)
    require(data.get("schema_version") == "stage1.production_action_matrix.v1", "production action matrix schema mismatch")
    require(data.get("release_gate_decision") == "no_go", "production action matrix must remain no_go")
    require(data.get("non_clearing_action_matrix") is True, "production action matrix must be non-clearing")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "production action matrix cannot clear launch gate")
    require(data.get("can_close_do_not_launch") is False, "production action matrix cannot close do-not-launch")
    lanes = data.get("lanes")
    require(isinstance(lanes, list) and len(lanes) == 4, "production action matrix must expose four production lanes")
    require(
        [lane.get("lane_id") for lane in lanes if isinstance(lane, dict)]
        == [
            "production_dns_https",
            "production_live_billing",
            "production_security_runtime",
            "production_governance_release",
        ],
        "production action matrix lane order mismatch",
    )
    not_current = data.get("not_current_blockers")
    require(isinstance(not_current, list), "production action matrix not_current_blockers must be list")
    for blocker in ACTION_MATRIX_LOOP_BREAKERS:
        require(blocker in not_current, f"production action matrix missing loop breaker {blocker!r}")
    help_queue = data.get("immediate_user_help_queue")
    require(isinstance(help_queue, list) and len(help_queue) == 4, "production action matrix help queue must contain four asks")
    help_asks = [item.get("ask") for item in help_queue if isinstance(item, dict)]
    for ask in ACTION_MATRIX_HELP_ASKS:
        require(ask in help_asks, f"production action matrix missing help ask {ask!r}")

    panel_body = extract_function_body(page, "ProductionActionMatrixPanel")
    for snippet in (
        "matrix.immediateHelpQueue",
        "matrix.notCurrentBlockers",
        "data-production-action-matrix=\"validator-derived\"",
        "data-production-action-matrix-non-clearing",
        "Immediate Help Queue",
        "Not Current Blockers",
    ):
        require(snippet in panel_body, f"production action matrix panel missing {snippet!r}")
    require(not RAW_SECRET_RE.search(panel_body), "production action matrix panel contains raw secret-looking material")


def validate_next_blockers_summary_contract(page: str) -> None:
    data = load_json(NEXT_BLOCKERS_SUMMARY)
    require(data.get("schema_version") == "stage1.next_blockers_summary.v1", "next blockers summary schema mismatch")
    require(data.get("status") == "blocked", "next blockers summary must remain blocked")
    require(data.get("release_gate_decision") == "no_go", "next blockers summary must remain no_go")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "next blockers summary cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "next blockers summary cannot close do-not-launch")
    require(data.get("secret_material_persisted") is False, "next blockers summary must not persist secrets")
    require(data.get("raw_run_command_output_persisted") is False, "next blockers summary must not persist raw Run Command output")
    stage1 = data.get("stage1")
    production_inputs = data.get("production_inputs")
    source_probes = data.get("production_source_probes")
    azure = data.get("azure_origin")
    diagnosis = data.get("azure_run_command_diagnosis")
    action = data.get("top_priority_action")
    closure_queue = load_json(RELEASE_EVIDENCE_CLOSURE_QUEUE)
    queue_summary = closure_queue.get("queue_summary")
    require(isinstance(stage1, dict), "next blockers Stage1 counters missing")
    require(isinstance(queue_summary, dict), "release evidence closure queue summary missing")
    for key in ("completed", "total", "open", "completion_percent", "open_gates"):
        require(stage1.get(key) == queue_summary.get(key), f"next blockers Stage1 {key} mismatch")
    require(
        isinstance(production_inputs, dict)
        and production_inputs.get("configured") == 2
        and production_inputs.get("total") == 60
        and production_inputs.get("blocking_input_count") == 58,
        "next blockers production input counters mismatch",
    )
    require(
        isinstance(source_probes, dict) and source_probes.get("ready") == 0 and source_probes.get("total") == 4,
        "next blockers source probe counters mismatch",
    )
    require(
        isinstance(azure, dict)
        and azure.get("status") == "pass"
        and azure.get("http_passed") == 4
        and azure.get("http_total") == 6
        and azure.get("ssh_status") == "pass",
        "next blockers Azure origin pass counters mismatch",
    )
    require(isinstance(diagnosis, dict), "next blockers diagnosis must remain present for historical Run Command handoff context")
    require(diagnosis.get("status") == "superseded", "next blockers Run Command diagnosis should be superseded after Azure origin pass")
    require(diagnosis.get("superseded_by") == "azure_origin_pass", "next blockers Run Command superseded_by mismatch")
    require(diagnosis.get("findings") == [], "next blockers Run Command findings must be empty after Azure origin pass")
    require("missing_output" in diagnosis.get("source_findings", []), "next blockers Run Command source findings must preserve stale source context")
    require(isinstance(action, dict), "next blockers top priority action must be object")
    top_action_id = action.get("action_id")
    require(
        top_action_id in {"production_source_probes_missing", "production_dns_https"},
        "next blockers top priority action mismatch",
    )
    shortlist = data.get("operator_shortlist")
    require(isinstance(shortlist, list) and len(shortlist) == 4, "next blockers operator shortlist must have four production items after Azure origin pass")
    shortlist_ids = [item.get("item_id") for item in shortlist if isinstance(item, dict)]
    for item_id in (
        "production_dns_https",
        "production_live_billing",
        "production_security_runtime",
        "production_governance_release",
    ):
        require(item_id in shortlist_ids, f"next blockers operator shortlist missing {item_id}")
    require("azure_run_command_output_missing" not in shortlist_ids, "next blockers operator shortlist must not list Azure after origin pass")
    action_packet = data.get("operator_action_packet")
    expected_packet_len = 5 if top_action_id == "production_source_probes_missing" else 4
    require(
        isinstance(action_packet, list) and len(action_packet) == expected_packet_len,
        f"next blockers operator action packet must have {expected_packet_len} items after Azure origin pass",
    )
    action_packet_by_id = {item.get("item_id"): item for item in action_packet if isinstance(item, dict)}
    required_packet_ids = list(shortlist_ids)
    if top_action_id == "production_source_probes_missing":
        required_packet_ids.insert(0, "production_source_probes_missing")
    for item_id in required_packet_ids:
        require(item_id in action_packet_by_id, f"next blockers action packet missing {item_id}")
    require("azure_run_command_output_missing" not in action_packet_by_id, "next blockers action packet must not list Azure after origin pass")
    if top_action_id == "production_source_probes_missing":
        require(
            "ingest_stage1_production_return_artifacts.py" in action_packet_by_id["production_source_probes_missing"].get("agent_command_after_return", ""),
            "production source probes action packet ingest command missing",
        )
    require(action_packet_by_id["production_dns_https"].get("owner") == "operator_cloudflare_dns", "DNS action packet owner mismatch")
    require(
        "stage1_production_dns_cutover_plan.py" in action_packet_by_id["production_dns_https"].get("agent_command_after_return", ""),
        "DNS action packet must start with DNS cutover plan",
    )
    require(
        "stage1_production_dns_readiness.py" in action_packet_by_id["production_dns_https"].get("validation_after_return", ""),
        "DNS action packet validation must rerun DNS readiness",
    )
    require("R2 S3" in action_packet_by_id["production_dns_https"].get("blind_handoff_note", ""), "DNS action packet must warn R2 S3 is not DNS")

    panel_body = extract_function_body(page, "Stage1NextBlockersSummaryPanel")
    for snippet in (
        'data-stage1-next-blockers-summary="validator-derived"',
        "data-stage1-next-blockers-summary-export",
        "data-stage1-next-blockers-summary-non-clearing",
        "data-stage1-next-blockers-summary-top-action",
        "data-stage1-next-blockers-operator-shortlist",
        "data-stage1-next-blockers-operator-shortlist-count",
        "data-stage1-next-blockers-action-packet",
        "data-stage1-next-blockers-action-packet-count",
        "Stage1 Next Blockers",
        "Operator Shortlist",
        "Operator Action Packet",
        "Blind-friendly return artifacts",
        "Top Priority Action",
        "Run Command diagnosis",
        "Run Command source findings",
        "Raw output persisted",
        "supersededBy",
        "Safe projection flags",
        "raw_run_command_output_persisted",
        "validate_stage1_next_blockers_summary.py",
        "generate_stage1_next_blockers_summary.py",
    ):
        require(snippet in panel_body, f"next blockers summary panel missing {snippet!r}")
    require("ingest_stage1_production_return_artifacts.py" in page, "release page must surface production return artifact ingest")
    require("ingest_azure_run_command_output.py" in page, "release page must surface Azure Run Command ingest")
    require("sanitize_azure_run_command_output.py" in page, "release page must surface Azure Run Command sanitizer")
    require(not RAW_SECRET_RE.search(panel_body), "next blockers summary panel contains raw secret-looking material")


def validate_azure_run_command_handoff_contract(page: str) -> None:
    for snippet in AZURE_RUN_COMMAND_SNIPPETS:
        require(snippet in page, f"Azure Run Command handoff missing {snippet!r}")

    builder_body = extract_function_body(page, "azureRunCommandHandoffRows")
    for snippet in (
        "operator_card",
        "portal_payload",
        "local_ingest",
        "post_ingest_guard",
        "readiness.transportDiagnosis.operatorSummary",
        "readiness.transportDiagnosis.lane",
        "readiness.transportDiagnosis.sshPasswordKeyRepairViable",
        "AZURE_RUN_COMMAND_OPERATOR_CARD",
        "AZURE_RUN_COMMAND_PAYLOAD",
        "AZURE_RUN_COMMAND_INGEST",
        "RunShellScript",
        "stdin",
        "sanitizes output",
        "preserves no_go",
    ):
        require(snippet in builder_body, f"Azure Run Command handoff builder missing {snippet!r}")
    require("raw output" not in builder_body.lower(), "Azure Run Command handoff builder must not request raw output persistence")
    require("password" not in builder_body.lower() or "password/key repair viable" in builder_body, "Azure handoff must not ask for password entry")
    require(not RAW_SECRET_RE.search(builder_body), "Azure Run Command handoff builder contains raw secret-looking material")

    panel_body = extract_function_body(page, "AzureOriginReadinessPanel")
    for snippet in (
        "data-azure-run-command-handoff",
        "data-azure-run-command-operator-card",
        "data-azure-run-command-payload",
        "data-azure-run-command-ingest",
        "data-azure-run-command-password-key-repair-viable",
        "data-azure-run-command-required",
        "Azure Portal Run Command Handoff",
        "RunShellScript",
        "Payload path",
        "Local ingest",
        "Not a password loop",
        "transport first",
        "DataTable<AzureRunCommandHandoffRow>",
    ):
        require(snippet in panel_body, f"Azure Run Command handoff panel missing {snippet!r}")
    for forbidden in ("<button", "<form", 'type="submit"', "onClick=", "href=", "window.", "fetch("):
        require(forbidden not in panel_body, f"Azure Run Command handoff must not expose execution control {forbidden!r}")
    require("raw output is sanitized" in panel_body, "Azure handoff must state raw output is sanitized")
    require(not RAW_SECRET_RE.search(panel_body), "Azure Run Command handoff panel contains raw secret-looking material")


def require_packet_base(packet_id: str, data: dict[str, Any]) -> None:
    require(data.get("environment") == "production", f"{packet_id} operator packet must target production")
    require(data.get("status") == "blocked", f"{packet_id} operator packet must remain blocked")
    require(data.get("release_gate_decision") == "no_go", f"{packet_id} operator packet must remain no_go")
    require(data.get("non_clearing_operator_packet") is True, f"{packet_id} operator packet must be non-clearing")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{packet_id} operator packet safe field {field} must be false")
    blocked_until = data.get("blocked_until")
    evidence_outputs = data.get("evidence_outputs")
    execution_order = data.get("execution_order")
    source_probe = data.get("source_probe")
    require(isinstance(blocked_until, list) and blocked_until, f"{packet_id} operator packet missing blocked_until")
    require(isinstance(evidence_outputs, dict) and evidence_outputs, f"{packet_id} operator packet missing evidence_outputs")
    require(isinstance(execution_order, list) and execution_order, f"{packet_id} operator packet missing execution_order")
    require(isinstance(source_probe, dict), f"{packet_id} operator packet missing source_probe")
    require(source_probe.get("canonical_source_exists") is False, f"{packet_id} operator packet cannot report canonical source exists")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{packet_id} operator packet contains raw secret-looking material")


def validate_operator_packet_handoff_contract(page: str) -> None:
    packets = {packet_id: load_json(path) for packet_id, path in PRODUCTION_OPERATOR_PACKET_PATHS.items()}
    for packet_id, data in packets.items():
        require_packet_base(packet_id, data)

    billing = packets["billing"]
    require(billing.get("schema_version") == "stage1.production_billing_operator_packet.v1", "billing operator packet schema mismatch")
    require(billing.get("release_gate_check_id") == "production_paid_billing_lifecycle", "billing gate check mismatch")
    require(billing.get("can_clear_production_paid_billing_lifecycle") is False, "billing packet cannot clear billing lifecycle")
    sandbox_scope = billing.get("sandbox_scope")
    require(isinstance(sandbox_scope, dict), "billing packet sandbox_scope missing")
    require(
        sandbox_scope.get("sandbox_can_clear_production_live_billing") is False,
        "billing packet sandbox_scope must preserve production non-clearing boundary",
    )
    require(
        "STRIPE_MODE=live" in (sandbox_scope.get("live_billing_requires") or []),
        "billing packet sandbox_scope must require live Stripe mode",
    )
    require(
        billing.get("live_mode_prerequisites", {}).get("sandbox_can_clear_production_live_billing") is False,
        "billing packet live prerequisites must reject sandbox clearing production billing",
    )
    require(len(billing.get("required_live_artifacts") or []) == 14, "billing packet live artifact count mismatch")
    require(len(billing.get("required_numeric_controls") or []) == 5, "billing packet numeric control count mismatch")
    webhook_controls = billing.get("required_webhook_controls")
    require(isinstance(webhook_controls, dict) and len(webhook_controls) == 5, "billing packet webhook control count mismatch")
    require(len(billing.get("required_audit_refs") or []) == 14, "billing packet audit ref count mismatch")
    require(len(billing.get("execution_order") or []) == 7, "billing packet execution order count mismatch")
    require(len(billing.get("blocked_until") or []) == 8, "billing packet blocked_until count mismatch")
    require(
        "Stripe sandbox/test configuration is replaced with production live-mode billing proof inputs"
        in (billing.get("blocked_until") or []),
        "billing packet blocked_until must require replacing sandbox/test billing config",
    )
    require(len(billing.get("evidence_outputs") or {}) == 6, "billing packet evidence output count mismatch")

    security = packets["security"]
    require(security.get("schema_version") == "stage1.production_security_operator_packet.v1", "security operator packet schema mismatch")
    require(security.get("release_gate_check_id") == "production_security_launch_checks", "security gate check mismatch")
    require(security.get("can_clear_production_security_launch_checks") is False, "security packet cannot clear launch checks")
    require(len(security.get("required_security_runtime_refs") or []) == 10, "security packet runtime ref count mismatch")
    require(len(security.get("execution_order") or []) == 7, "security packet execution order count mismatch")
    require(len(security.get("blocked_until") or []) == 12, "security packet blocked_until count mismatch")
    require(len(security.get("evidence_outputs") or {}) == 5, "security packet evidence output count mismatch")
    security_private_env = security.get("private_env_template")
    require(isinstance(security_private_env, dict), "security packet private env template missing")
    require(len(security_private_env.get("template_lines") or []) == 13, "security packet private env template count mismatch")
    require(len(security.get("operator_command_packet") or []) == 6, "security packet operator command count mismatch")

    legal = packets["legal_support"]
    require(legal.get("schema_version") == "stage1.production_legal_support_operator_packet.v1", "legal/support operator packet schema mismatch")
    require(legal.get("release_gate_check_id") == "production_legal_support_policy", "legal/support gate check mismatch")
    require(legal.get("can_clear_production_legal_support_policy") is False, "legal/support packet cannot clear policy")
    require(legal.get("production_web_url") == "https://zenari.ai", "legal/support production web URL mismatch")
    dns_requirements = legal.get("required_dns_and_https")
    require(isinstance(dns_requirements, dict) and len(dns_requirements) == 6, "legal/support DNS HTTPS requirement count mismatch")
    require(len(legal.get("required_public_paths") or []) == 9, "legal/support public path count mismatch")
    dns_readiness = legal.get("dns_readiness")
    require(isinstance(dns_readiness, dict), "legal/support packet missing dns_readiness")
    require(len(dns_readiness.get("production_paths") or []) == 8, "legal/support production path probe count mismatch")
    require(len(legal.get("operator_next_actions") or []) == 6, "legal/support next action count mismatch")
    require(len(legal.get("execution_order") or []) == 10, "legal/support execution order count mismatch")
    require(len(legal.get("blocked_until") or []) == 7, "legal/support blocked_until count mismatch")
    require(len(legal.get("evidence_outputs") or {}) == 6, "legal/support evidence output count mismatch")
    legal_commands = legal.get("operator_command_packet")
    require(isinstance(legal_commands, list) and len(legal_commands) == 9, "legal/support operator command count mismatch")
    require(
        [row.get("step_id") for row in legal_commands if isinstance(row, dict)]
        == [
            "plan_dns_cutover_with_private_env",
            "verify_cloudflare_scope_before_apply",
            "apply_dns_cutover_after_review",
            "refresh_dns_readiness",
            "run_legal_support_source_probe_after_https_passes",
            "generate_strict_legal_support_evidence",
            "validate_strict_legal_support_evidence",
            "refresh_production_launch_evidence",
            "validate_production_launch_evidence",
        ],
        "legal/support operator command order mismatch",
    )
    legal_plan_command = legal_commands[0].get("command") if isinstance(legal_commands[0], dict) else ""
    legal_verify_command = legal_commands[1].get("command") if isinstance(legal_commands[1], dict) else ""
    legal_apply_command = legal_commands[2].get("command") if isinstance(legal_commands[2], dict) else ""
    legal_source_command = legal_commands[4].get("command") if isinstance(legal_commands[4], dict) else ""
    require("--env <private-production-env>" in legal_plan_command and "--apply" not in legal_plan_command, "legal/support DNS plan command mismatch")
    require("--env <private-production-env>" in legal_verify_command and "--verify-cloudflare" in legal_verify_command, "legal/support Cloudflare verify command mismatch")
    require("--env <private-production-env>" in legal_apply_command and "--apply" in legal_apply_command, "legal/support DNS apply command mismatch")
    require(legal_commands[2].get("may_apply_production_dns") is True, "legal/support DNS apply flag mismatch")
    require(legal_commands[2].get("requires_review") is True, "legal/support DNS apply must require review")
    require("--write-canonical-source" in legal_source_command, "legal/support source probe must explicitly write canonical source")
    require("--production-web-url https://zenari.ai" in legal_source_command, "legal/support source probe must target zenari.ai")
    require(legal_commands[4].get("may_write_canonical_source") is True, "legal/support canonical source flag mismatch")
    require(legal_commands[4].get("requires_review") is True, "legal/support canonical source write must require review")

    governance = packets["governance"]
    require(governance.get("schema_version") == "stage1.production_governance_operator_packet.v1", "governance operator packet schema mismatch")
    require(governance.get("release_gate_check_id") == "production_governance_release", "governance gate check mismatch")
    require(governance.get("can_clear_production_governance_release") is False, "governance packet cannot clear governance release")
    components = governance.get("required_governance_components")
    require(isinstance(components, list) and len(components) == 3, "governance component count mismatch")
    require([component.get("component") for component in components] == ["activation", "abuse", "skill"], "governance component order mismatch")
    section_ref_count = sum(len(component.get("required_section_refs") or []) for component in components if isinstance(component, dict))
    required_id_count = sum(len(component.get("required_ids") or []) for component in components if isinstance(component, dict))
    require(section_ref_count == 15, "governance section ref count mismatch")
    require(required_id_count == 5, "governance required ID count mismatch")
    require(len(governance.get("execution_order") or []) == 7, "governance execution order count mismatch")
    require(len(governance.get("blocked_until") or []) == 9, "governance blocked_until count mismatch")
    require(len(governance.get("evidence_outputs") or {}) == 7, "governance evidence output count mismatch")
    governance_private_env = governance.get("private_env_template")
    require(isinstance(governance_private_env, dict), "governance packet private env template missing")
    require(len(governance_private_env.get("template_lines") or []) == 27, "governance packet private env template count mismatch")
    require(len(governance.get("operator_command_packet") or []) == 6, "governance packet operator command count mismatch")

    panel_body = extract_function_body(page, "ProductionOperatorPacketsPanel")
    for snippet in (
        'data-production-operator-packets="validator-derived"',
        'data-production-operator-packets-non-clearing="true"',
        'data-production-billing-operator-packet="ops/evidence/non_clearing/production-billing-operator-packet.json"',
        'data-production-security-operator-packet="ops/evidence/non_clearing/production-security-operator-packet.json"',
        'data-production-legal-support-operator-packet="ops/evidence/non_clearing/production-legal-support-operator-packet.json"',
        'data-production-governance-operator-packet="ops/evidence/non_clearing/production-governance-operator-packet.json"',
        'data-production-billing-live-artifacts="variable-names-only"',
        "Billing Private Env Template",
        "Billing Operator Command Packet",
        'data-production-security-runtime-refs="variable-names-only"',
        'data-production-security-private-env-template="blank-values-only"',
        'data-production-security-operator-command-packet="review-gated-source-write"',
        'data-production-legal-support-public-paths="public-path-tokens-only"',
        'data-production-legal-support-operator-command-packet="review-gated-dns-and-source-write"',
        'data-production-governance-required-ids="variable-names-only"',
        'data-production-governance-private-env-template="blank-values-only"',
        'data-production-governance-operator-command-packet="review-gated-source-write"',
        "Production Operator Packets",
        "Billing Live Proof Inputs",
        "Required Live Stripe Artifacts",
        "Security Runtime Proof Inputs",
        "Required Security Runtime Refs",
        "Security Private Env Template",
        "Security Operator Command Packet",
        "Legal Support Production Proof Inputs",
        "Required Legal Support Public Paths",
        "Legal Operator Command Packet",
        "Governance Production Proof Inputs",
        "Governance Required IDs",
        "Governance Private Env Template",
        "Governance Operator Command Packet",
        "Packet Summary",
        "Source Probe Commands",
        "Requirement Groups",
        "Blocked Until",
        "Evidence Outputs",
    ):
        require(snippet in panel_body, f"production operator packets panel missing {snippet!r}")
    for forbidden in ("<button", "<form", 'type="submit"', "onClick=", "href=", "window.", "fetch("):
        require(forbidden not in panel_body, f"operator packets panel must not expose execution control {forbidden!r}")
    require(not RAW_SECRET_RE.search(panel_body), "production operator packets panel contains raw secret-looking material")


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.release_readiness.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "release_readiness_admin_contract", "fixture kind mismatch")
    require({"AD-14", "VF-6", "VF-7", "VF-8", "OP-14"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("admin_route") == "admin/app/release/page.tsx", "fixture admin route mismatch")
    require(data.get("data_source") == "validator_evidence_only", "fixture data source mismatch")
    require(data.get("manual_go_controls_enabled") is False, "fixture must disable manual go controls")

    aggregates = data.get("required_aggregate_evidence")
    require(
        isinstance(aggregates, list) and len(aggregates) == 4,
        "fixture must list staging, production, closure queue, and external resource readiness aggregates",
    )
    by_id = {item.get("id"): item for item in aggregates if isinstance(item, dict)}
    require(
        {"staging_runtime", "production_launch", "release_evidence_closure_queue", "external_resource_readiness"} <= set(by_id),
        "fixture missing aggregate evidence anchors",
    )
    require(by_id["staging_runtime"].get("evidence_path") == "ops/evidence/staging/stage1-runtime.json", "staging evidence path mismatch")
    require(by_id["production_launch"].get("evidence_path") == "ops/evidence/production/stage1-production-launch.json", "production evidence path mismatch")
    require(
        by_id["release_evidence_closure_queue"].get("evidence_path")
        == "ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json",
        "closure queue evidence path mismatch",
    )
    require(
        by_id["external_resource_readiness"].get("evidence_path")
        == "ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json",
        "external resource readiness evidence path mismatch",
    )
    for item in by_id.values():
        require(str(item.get("contract_validator_command", "")).endswith("--contract-only"), "contract validator must use contract-only mode")
        require(str(item.get("strict_validator_command", "")).startswith("python3 scripts/validate_stage1_"), "strict validator command mismatch")
        require(str(item.get("generator_command", "")).startswith("python3 scripts/generate_stage1_"), "generator command mismatch")

    projection_fields = set(data.get("required_projection_fields") or [])
    require(
        {
            "status",
            "release_gate_decision",
            "components",
            "blockers",
            "do_not_launch_conditions",
            "runtime_input_readiness",
            "load_ready",
            "validator_commands",
            "gate_safety",
            "strict_gate_ready",
            "strict_gate_blockers",
            "results_present",
            "result_rows",
            "release_gate_fixtures",
            "ci_evidence",
            "release_bundle_preflight",
            "stage1_staging_runtime_verified",
            "stage1_quota_replay_verified",
            "stage1_quota_replay_blocking_reasons",
            "stage1_load_verified",
            "stage1_load_blocking_reasons",
            "object_retention_cleanup_verified",
            "legal_support_visibility_verified",
            "ci_closure_artifacts_ready",
            "production_backup_rollback_split_ready",
            "release_metadata_preflight_status",
            "release_metadata_preflight_complete",
            "release_metadata_missing_slots",
            "release_metadata_unverified_slots",
            "release_metadata_blocking_reasons",
            "missing_slots",
            "unverified_slots",
            "ci_closure_artifact_blocking_reasons",
            "production_backup_rollback_split_blocking_reasons",
            "blocking_reason_count",
            "blocking_reasons",
            "resource_readiness",
            "external_resource_readiness",
            "stage1-external-resource-readiness.preflight.json",
            "generate_stage1_external_resource_readiness.py",
            "validate_stage1_external_resource_readiness.py --allow-preflight",
            "llm_zai_openai_compatible",
            "r2_zenari_bucket",
            "staging_public_urls",
            "staging_admin_access",
            "staging_quota_replay_db",
            "ci_exact_artifacts",
            "production_launch_inputs",
            "ready_percent",
            "operator_ask",
            "evidence_closure_queue",
            "release_evidence_closure_queue",
            "stage1-evidence-closure-queue.preflight.json",
            "generate_stage1_release_evidence_closure_queue.py",
            "validate_stage1_release_evidence_closure_queue.py --allow-preflight",
            "staging_quota_replay",
            "ci_pr_main_run",
            "ci_playwright_smoke",
            "ci_docker_image_build",
            "stage1_production_launch_preflight",
            "validate_stage1_production_launch.py --allow-preflight",
            "production_backup_rollback_split",
            "backup-rollback-split.blocked",
            "production_backup_rollback_split_preflight",
        }
        <= projection_fields,
        "fixture required_projection_fields must include aggregate gate safety and release bundle preflight projection",
    )

    non_launch = data.get("non_launch_status")
    require(isinstance(non_launch, dict), "fixture non_launch_status must be object")
    require(non_launch.get("local_contract") == "pass", "local contract status mismatch")
    require(non_launch.get("staging_evidence") == "open", "staging evidence must remain open")
    require(non_launch.get("production_evidence") == "open", "production evidence must remain open")
    require(non_launch.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(non_launch.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")
    require(non_launch.get("can_close_do_not_launch") is False, "local contract must not close DNL")
    for ref in data.get("required_files", []):
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")


def validate_admin() -> None:
    page = require_text(
        ADMIN_PAGE,
        (
            "Release Readiness",
            "Gate Verdict",
            "Stage 1 Staging Runtime",
            "Stage 1 Production Launch",
            "Release Bundle Preflight",
            "External Resource Readiness",
            "Evidence Closure Queue",
            "Provider Sandbox Handoff",
            "Stage 0 Gate Dependencies",
            "CI Evidence",
            "Validator Contract Anchors",
            "Next Operator Actions",
            "Copy-Safe Production Commands",
            "ProductionCopySafeCommandRow",
            "productionCopySafeCommandRows",
            "ProductionCopySafeCommandListPanel",
            'data-production-copy-safe-commands="operator-handoff"',
            "data-production-copy-safe-commands-non-clearing",
            'data-production-copy-safe-commands-private-env="<private-production-env>"',
            'data-production-copy-safe-commands-exec-controls="absent"',
            "copy-safe list does not include --apply",
            "Command List",
            "refresh_validate",
            "dns_plan",
            "dns_readiness",
            "dns_repair_packet",
            "private_env_template",
            "proof_bundle_private_env",
            "proof_bundle_validate",
            "launch_input_packet",
            "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json || test $? -eq 2",
            "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
            "Production Action Matrix",
            'data-production-action-matrix="validator-derived"',
            "data-production-action-matrix-non-clearing",
            "Immediate Help Queue",
            "Not Current Blockers",
            "Production Operator Packets",
            'data-production-operator-packets="validator-derived"',
            'data-production-operator-packets-non-clearing="true"',
            "Billing Live Proof Inputs",
            "Required Live Stripe Artifacts",
            "Billing Private Env Template",
            "Billing Operator Command Packet",
            "Security Runtime Proof Inputs",
            "Required Security Runtime Refs",
            "Legal Support Production Proof Inputs",
            "Required Legal Support Public Paths",
            "Governance Production Proof Inputs",
            "Governance Required IDs",
            "Private DNS Env Template",
            "DNS Operator Command Packet",
            "<private-production-env>",
            "Strict Gate Checks",
            "Missing Evidence Refs",
            "Aggregate Results Rows",
            "Check-Level Pass",
            "Preserved Gate Blockers",
            "manualGoControlsEnabled",
            "decisionSource",
            "validator_evidence_only",
            "releaseGateDecision",
            "doNotLaunchConditions",
            "runtimeInputReadiness",
            "gateSafety",
            "strictGateReady",
            "strictGateBlockers",
            "missingEvidenceRefs",
            "resultsPresent",
            "resultRows",
            "checkLevelPassed",
            "checkLevelBlockersPreserved",
            "resultsPath",
            "safetyPolicy",
            "strictValidatorCommand",
            "releaseBundlePreflight",
            "stage1StagingRuntimeVerified",
            "stage1QuotaReplayVerified",
            "stage1QuotaReplayBlockingReasons",
            "stage1LoadVerified",
            "stage1LoadBlockingReasons",
            "objectRetentionCleanupVerified",
            "legalSupportVisibilityVerified",
            "ciClosureArtifactsReady",
            "productionBackupRollbackSplitReady",
            "releaseMetadataPreflightStatus",
            "releaseMetadataPreflightComplete",
            "releaseMetadataMissingSlots",
            "releaseMetadataUnverifiedSlots",
            "releaseMetadataBlockingReasons",
            "missingSlots",
            "unverifiedSlots",
            "ciClosureArtifactBlockingReasons",
            "productionBackupRollbackSplitBlockingReasons",
            "blockingReasonCount",
            "blockingReasons",
            "Stage1ExternalResourceGroup",
            "resourceReadiness",
            "data-stage1-next-blockers-action-packet",
            "data-stage1-next-blockers-action-packet-count",
            "operatorActionPacket",
            "Operator Action Packet",
            "data-external-resource-readiness",
            "external_resource_readiness",
            "Non-Clearing Refresh Summary",
            "data-external-resource-non-clearing-refresh-summary",
            "data-external-resource-non-clearing-refresh-source",
            "nonClearingRefreshSummary",
            "blockedEvidenceDetails",
            "production-non-clearing-refresh.json",
            "production_dns_readiness",
            "production_dns_cutover_plan",
            "production_proof_bundle",
            "stage1-external-resource-readiness.preflight.json",
            "generate_stage1_external_resource_readiness.py",
            "validate_stage1_external_resource_readiness.py --allow-preflight",
            "Stage1EvidenceClosureQueueRow",
            "Stage1EvidenceClosureQueueOperatorActionPacketItem",
            "rowStatus",
            "completed",
            "completionPercent",
            "operatorActionPacketSummary",
            "operatorActionPacketItems",
            "data-release-evidence-operator-action-packet-summary",
            "data-release-evidence-operator-action-packet-count",
            "data-release-evidence-operator-action-packet-non-clearing",
            "Production / Azure Operator Action Packet",
            "ProviderSandboxHandoffRow",
            "data-release-evidence-closure-queue",
            "data-provider-sandbox-handoff",
            "validator-derived",
            "providerSandboxHandoffRows",
            "providerFailureCategory",
            "provider_sandbox_component",
            "provider_sandbox_result_row",
            "provider_failure_category",
            "openai_compatible_selftest",
            "provider_safe_projection",
            "provider_quota_unavailable",
            "provider_retryable_http_error",
            "provider_http_error",
            "ops/evidence/staging/stage1-provider-sandbox.json + .ndjson",
            "scripts/openai_compatible_provider_selftest.sh --contract-only",
            "python3 scripts/validate_stage1_provider_sandbox_evidence.py --contract-only",
            "rawProviderPayloadPersisted",
            "--allow-preflight",
        ),
    )
    forbidden = (
        "form action",
        "<form",
        "type=\"submit\"",
        "manual go",
        "mark go",
        "set go",
    )
    lowered = page.lower()
    for token in forbidden:
        require(token not in lowered, f"release readiness page must not expose manual go control token {token!r}")
    require(not RAW_SECRET_RE.search(page), "release readiness page contains raw secret-looking material")
    validate_copy_safe_command_contract(page)
    validate_next_blockers_summary_contract(page)
    validate_azure_run_command_handoff_contract(page)
    validate_action_matrix_handoff_contract(page)
    validate_operator_packet_handoff_contract(page)

    require_text(ADMIN_SHELL, ("Release Readiness", '"/release"'))
    require_text(
        ADMIN_API,
        (
            "getStage1ReleaseReadiness",
            "ops/evidence/staging/stage1-runtime.json",
            "ops/evidence/production/stage1-production-launch.json",
            "ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json",
            "ops/evidence/staging/stage1-azure-origin-readiness.json",
            "ops/evidence/non_clearing/stage1-next-blockers-summary.json",
            "decisionSource: \"validator_evidence_only\"",
            "manualGoControlsEnabled: false",
            "buildStage1AggregateGateSafety",
            "extractStage1MissingEvidenceRefs",
            "gateSafety",
            "strictGateReady",
            "strictGateBlockers",
            "missingEvidenceRefs",
            "readNdjsonIfPresent",
            "mapStage1AggregateResultRow",
            "resultsPresent",
            "resultRows",
            "checkLevelPassed",
            "checkLevelBlockersPreserved",
            "checkLevelEvidenceRefs",
            "stage1-runtime.ndjson",
            "stage1-production-launch.ndjson",
            "contractValidatorCommand",
            "strictValidatorCommand",
            "preflightValidatorCommand",
            "generatorCommand",
            "mapStage1AggregateEvidence",
            "missingStage1AggregateEvidence",
            "mapStage1ReleaseBundlePreflight",
            "mapStage1EvidenceClosureQueue",
            "missingStage1EvidenceClosureQueue",
            "mapStage1EvidenceClosureQueueOperatorActionPacketSummary",
            "missingStage1EvidenceClosureQueueOperatorActionPacketSummary",
            "operatorActionPacketSummary",
            "operatorActionPacketItems",
            "mapStage1ExternalResourceReadiness",
            "missingStage1ExternalResourceReadiness",
            "mapStage1ExternalResourceNonClearingRefreshSummary",
            "missingStage1ExternalResourceNonClearingRefreshSummary",
            "mapStage1AzureOriginReadiness",
            "missingStage1AzureOriginReadiness",
            "mapStage1NextBlockersSummary",
            "missingStage1NextBlockersSummary",
            "mapStage1NextBlockersOperatorShortlistItem",
            "summarizeStage1NextBlockersSummaryActions",
            "resourceReadiness",
            "azureOriginReadiness",
            "nextBlockersSummary",
            "Stage1AzureOriginReadiness",
            "Stage1NextBlockersSummary",
            "Stage1ExternalResourceReadiness",
            "Stage1ExternalResourceNonClearingRefreshSummary",
            "Stage1ExternalResourceGroup",
            "blockedEvidenceDetails",
            "release_bundle_preflight",
            "stage1_staging_runtime_verified",
            "stage1_quota_replay_verified",
            "stage1_quota_replay_blocking_reasons",
            "stage1_load_verified",
            "stage1_load_blocking_reasons",
            "object_retention_cleanup_verified",
            "legal_support_visibility_verified",
            "ci_closure_artifacts_ready",
            "production_backup_rollback_split_ready",
            "release_metadata_preflight",
            "release_metadata_blocking_reasons",
            "missing_slots",
            "unverified_slots",
            "ci_closure_artifact_blocking_reasons",
            "production_backup_rollback_split_blocking_reasons",
            "blocking_reason_count",
            "blocking_reasons",
        ),
    )
    require_text(
        ADMIN_TYPES,
        (
            "Stage1ReleaseReadinessSnapshot",
            "Stage1AggregateEvidence",
            "Stage1EvidenceClosureQueue",
            "Stage1EvidenceClosureQueueRow",
            "Stage1EvidenceClosureQueueOperatorActionPacketSummary",
            "Stage1EvidenceClosureQueueOperatorActionPacketItem",
            "rowStatus",
            "completed",
            "completionPercent",
            "operatorActionPacketSummary",
            "operatorActionPacketItems",
            "Stage1ExternalResourceReadiness",
            "Stage1ExternalResourceNonClearingRefreshSummary",
            "Stage1NonClearingRefreshBlockedEvidenceDetail",
            "Stage1AzureOriginReadiness",
            "Stage1AzureOriginTcpProbe",
            "Stage1AzureOriginHttpProbe",
            "Stage1AzureOriginSshPreflight",
            "Stage1ExternalResourceGroup",
            "Stage1ReleaseBundlePreflight",
            "Stage1AggregateGateSafety",
            "Stage1AggregateGateCheck",
            "Stage1AggregateResultRow",
            "Stage1MissingEvidenceRef",
            "Stage1ReleaseReadinessComponent",
            "Stage1ReleaseGateFixture",
            "Stage1CIEvidence",
            "gateSafety",
            "strictGateReady",
            "missingEvidenceRefs",
            "resultsPresent",
            "resultRows",
            "releaseBundlePreflight",
            "stage1StagingRuntimeVerified",
            "stage1QuotaReplayVerified",
            "stage1QuotaReplayBlockingReasons",
            "objectRetentionCleanupVerified",
            "legalSupportVisibilityVerified",
            "ciClosureArtifactsReady",
            "productionBackupRollbackSplitReady",
            "releaseMetadataPreflightStatus",
            "releaseMetadataPreflightComplete",
            "releaseMetadataMissingSlots",
            "releaseMetadataUnverifiedSlots",
            "releaseMetadataBlockingReasons",
            "missingSlots",
            "unverifiedSlots",
            "ciClosureArtifactBlockingReasons",
            "productionBackupRollbackSplitBlockingReasons",
            "blockingReasonCount",
            "blockingReasons",
            "resourceReadiness",
            "nonClearingRefreshSummary",
            "blockedEvidenceDetails",
            "azureOriginReadiness",
            "nextBlockersSummary",
            "Stage1NextBlockersSummary",
            "closureQueue",
            "readyPercent",
            "operatorAsk",
            "manualGoControlsEnabled: false",
            "decisionSource: \"validator_evidence_only\"",
        ),
    )
    require_text(
        ADMIN_TESTS,
        (
            "admin release readiness panel reads aggregate validator evidence only",
            "getStage1ReleaseReadiness",
            "Release Readiness",
            "ProductionCopySafeCommandRow",
            "productionCopySafeCommandRows",
            "ProductionCopySafeCommandListPanel",
            "Copy-Safe Production Commands",
            'data-production-copy-safe-commands=\\"operator-handoff\\"',
            "data-production-copy-safe-commands-non-clearing",
            "data-production-copy-safe-commands-private-env",
            "data-production-copy-safe-commands-exec-controls",
            "<private-production-env>",
            "copy-safe list does not include --apply",
            "refresh.generatorCommand",
            "refresh.validatorCommand",
            "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json || test $? -eq 2",
            "python3 scripts/generate_stage1_production_dns_repair_packet.py --operator-markdown ops/evidence/non_clearing/production-dns-operator-checklist.md",
            "inputTemplate.generatorCommand",
            "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
            "proofBundle.strictValidator",
            "python3 scripts/generate_stage1_production_launch_input_packet.py",
            "Release Bundle Preflight",
            'data-production-action-matrix=\\"validator-derived\\"',
            'data-stage1-next-blockers-summary=\\"validator-derived\\"',
            "Stage1 Next Blockers",
            "stage1-next-blockers-summary.json",
            "Stage1NextBlockersSummaryPanel",
            "mapStage1NextBlockersSummary",
            "summarizeStage1NextBlockersSummaryActions",
            "operatorShortlist",
            "operatorActionPacket",
            "Operator Shortlist",
            "Operator Action Packet",
            "requiredReturnArtifact",
            "agentCommandAfterReturn",
            "blindHandoffNote",
            "raw_run_command_output_persisted",
            "production_source_probes_missing",
            "azure_run_command_output_missing",
            "ingest_stage1_production_return_artifacts.py",
            "Immediate Help Queue",
            "Not Current Blockers",
            "staging aggregate is already go",
            "R2 zenari bucket is already a staging resource, not the current production blocker",
            "Stripe sandbox is not the current blocker; live mode proof is required",
            "z.ai/OpenAI-compatible LLM is not the current blocker",
            "worker/crawler/migrate are backend runtime entrypoints, not release images",
            "manager is legacy local-only and not a release surface",
            "External Resource Readiness",
            "Non-Clearing Refresh Summary",
            "data-external-resource-non-clearing-refresh-summary",
            "data-external-resource-non-clearing-refresh-source",
            "nonClearingRefreshSummary",
            "blockedEvidenceDetails",
            "Stage1ExternalResourceNonClearingRefreshSummary",
            "Stage1NonClearingRefreshBlockedEvidenceDetail",
            "production_dns_readiness",
            "production_dns_cutover_plan",
            "production_proof_bundle",
            "Azure Origin Readiness",
            'data-azure-origin-readiness=\\"validator-derived\\"',
            "stage1-azure-origin-readiness.json",
            "stage1_azure_origin_readiness.py",
            "validate_stage1_azure_origin_readiness.py",
            "Password persisted",
            "SSH hard timeout",
            "Azure CLI preflight",
            "Repair env key",
            "Azure Origin Repair Commands",
            "sshHardTimeoutSeconds",
            "hardTimeoutSeconds",
            "hard_timeout_seconds",
            "ssh_connect_timeout",
            "azureCliPreflight",
            "az_cli_missing",
            "vm_found_by_public_ip",
            "ssh_server_not_responding",
            "ssh_auth_hard_timeout",
            "localRepairPasswordEnvKey",
            "localRepairPasswordConfigured",
            "originRepairCommands",
            "originDiagnosticsCommand",
            "originRepairCommand",
            "STAGING_SSH_PASSWORD",
            "scripts/azure_staging_run_command_payload.sh",
            "ingest_azure_run_command_output.py",
            "sanitize_azure_run_command_output.py",
            "classify_azure_run_command_output.py",
            "azure-run-command-ssh-repair-diagnosis.json",
            "scripts/azure_staging_cli_preflight.sh",
            "RUN_AZURE_STAGING_RUN_COMMAND=1 scripts/azure_staging_run_command_invoke.sh",
            "scripts/azure_staging_password_key_repair.sh",
            "scripts/azure_staging_origin_diagnostics.sh",
            "scripts/azure_staging_origin_repair.sh",
            "networkPhase",
            "failureCategory",
            "responseBytes",
            "http_no_bytes_after_request",
            "tls_serverhello_timeout",
            "https_no_bytes_after_tls",
            "Azure Origin Next Actions",
            "Evidence Closure Queue",
            "external_resource_readiness",
            "stage1-external-resource-readiness.preflight.json",
            "generate_stage1_external_resource_readiness.py",
            "validate_stage1_external_resource_readiness.py",
            "release_evidence_closure_queue",
            "stage1-evidence-closure-queue.preflight.json",
            "generate_stage1_release_evidence_closure_queue.py",
            "validate_stage1_release_evidence_closure_queue.py",
            "releaseBundlePreflight",
            "Stage1ReleaseBundlePreflight",
            "mapStage1ReleaseBundlePreflight",
            "stage1StagingRuntimeVerified",
            "stage1QuotaReplayVerified",
            "stage1QuotaReplayBlockingReasons",
            "stage1LoadVerified",
            "stage1LoadBlockingReasons",
            "objectRetentionCleanupVerified",
            "legalSupportVisibilityVerified",
            "ciClosureArtifactsReady",
            "productionBackupRollbackSplitReady",
            "release_bundle_preflight",
            "stage1_quota_replay_verified",
            "stage1_quota_replay_blocking_reasons",
            "stage1_load_verified",
            "stage1_load_blocking_reasons",
            "resourceReadiness",
            "closureQueue",
            "Stage1ExternalResourceReadiness",
            "Stage1ExternalResourceGroup",
            "Stage1EvidenceClosureQueue",
            "Stage1EvidenceClosureQueueRow",
            "Stage1EvidenceClosureQueueOperatorActionPacketSummary",
            "Stage1EvidenceClosureQueueOperatorActionPacketItem",
            "rowStatus",
            "completed",
            "completionPercent",
            "operatorActionPacketSummary",
            "operatorActionPacketItems",
            "readyPercent",
            "operatorAsk",
            "data-external-resource-readiness",
            "llm_zai_openai_compatible",
            "r2_zenari_bucket",
            "staging_public_urls",
            "staging_admin_access",
            "staging_quota_replay_db",
            "ci_exact_artifacts",
            "production_launch_inputs",
            "data-release-evidence-closure-queue",
            "data-provider-sandbox-handoff",
            "provider_sandbox_handoff",
            "provider_failure_category",
            "provider_quota_unavailable",
            "provider_retryable_http_error",
            "provider_http_error",
            "openai_compatible_selftest",
            "provider_safe_projection",
            "staging_quota_replay",
            "stage1_staging_runtime_preflight",
            "validate_stage1_staging_runtime.py --allow-preflight",
            "stage1-quota-replay.preflight",
            "object-storage-retention-cleanup.preflight",
            "preflight_stage1",
            "ci_pr_main_run",
            "ci_playwright_smoke",
            "ci_docker_image_build",
            "stage1_production_launch_preflight",
            "validate_stage1_production_launch.py --allow-preflight",
            "production_backup_rollback_split",
            "production_provider_claims",
            "production_paid_billing_lifecycle",
            "production_security_launch_checks",
            "production_legal_support_policy",
            "production_governance_release",
            "manualGoControlsEnabled: false",
            "ops/evidence/staging/stage1-runtime.json",
            "ops/evidence/production/stage1-production-launch.json",
            "validate_stage1_release_readiness_contract.py",
            "validate_stage1_release_evidence_closure_queue.py",
            "quota_replay_ready",
            "load_ready",
        ),
    )


def validate_repo_wiring() -> None:
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_release_readiness_contract.py",
            "test -x scripts/generate_stage1_release_evidence_closure_queue.py",
            "test -x scripts/validate_stage1_release_evidence_closure_queue.py",
            "test -x scripts/generate_stage1_external_resource_readiness.py",
            "test -x scripts/validate_stage1_external_resource_readiness.py",
            "test -x scripts/stage1_azure_origin_readiness.py",
            "test -x scripts/validate_stage1_azure_origin_readiness.py",
            "test -x scripts/ingest_azure_run_command_output.py",
            "test -x scripts/validate_azure_run_command_output_ingest.py",
            "test -x scripts/sanitize_azure_run_command_output.py",
            "test -x scripts/validate_azure_run_command_output_sanitizer.py",
            "test -x scripts/generate_stage1_next_blockers_summary.py",
            "test -x scripts/validate_stage1_next_blockers_summary.py",
            "python3 scripts/validate_stage1_release_readiness_contract.py",
            "python3 scripts/validate_stage1_release_evidence_closure_queue.py --contract-only",
            "python3 scripts/validate_stage1_external_resource_readiness.py --contract-only",
            "python3 scripts/stage1_azure_origin_readiness.py --contract-only",
            "python3 scripts/validate_stage1_azure_origin_readiness.py --contract-only",
            "python3 scripts/ingest_azure_run_command_output.py --contract-only",
            "python3 scripts/validate_azure_run_command_output_ingest.py",
            "python3 scripts/sanitize_azure_run_command_output.py --contract-only",
            "python3 scripts/validate_azure_run_command_output_sanitizer.py",
            "python3 scripts/generate_stage1_next_blockers_summary.py --contract-only",
            "python3 scripts/validate_stage1_next_blockers_summary.py --contract-only",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "VF-6a",
            "scripts/validate_stage1_release_readiness_contract.py",
            "admin `/release`",
            "validator evidence only",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_admin()
        validate_repo_wiring()
    except ReleaseReadinessContractError as exc:
        print(f"stage1 release readiness contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 release readiness contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
