#!/usr/bin/env python3
"""Generate a non-clearing Stage 1 production launch input packet.

The packet is an operator handoff artifact. It consolidates the exact live
production inputs, templates, diagnostics, and command order still needed to
assemble production source probes. It must never clear production launch gates.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_READINESS = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-external-resource-readiness.preflight.json"
DEFAULT_CLOSURE_QUEUE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-evidence-closure-queue.preflight.json"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-input-packet.json"
DEFAULT_DNS_READINESS = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_BILLING_OPERATOR_PACKET = (
    ROOT / "ops" / "evidence" / "non_clearing" / "production-billing-operator-packet.json"
)
DEFAULT_SECURITY_OPERATOR_PACKET = (
    ROOT / "ops" / "evidence" / "non_clearing" / "production-security-operator-packet.json"
)
DEFAULT_LEGAL_SUPPORT_OPERATOR_PACKET = (
    ROOT / "ops" / "evidence" / "non_clearing" / "production-legal-support-operator-packet.json"
)
DEFAULT_GOVERNANCE_OPERATOR_PACKET = (
    ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-operator-packet.json"
)
DEFAULT_PROOF_BUNDLE_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-proof-bundle.json"

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

TEMPLATE_REFS = {
    "billing_live_proof_template": "ops/evidence/non_clearing/templates/billing-live-proof.template.json",
    "billing_source_template": "ops/evidence/non_clearing/templates/production-source-probes/billing-paid-lifecycle-source.template.json",
    "security_proof_template": "ops/evidence/non_clearing/templates/production-source-probes/production-security-proof.template.json",
    "security_source_template": "ops/evidence/non_clearing/templates/production-source-probes/production-security-launch-source.template.json",
    "legal_support_source_template": "ops/evidence/non_clearing/templates/production-source-probes/production-legal-support-source.template.json",
    "governance_proof_template": "ops/evidence/non_clearing/templates/production-source-probes/production-governance-proof.template.json",
    "governance_source_template": "ops/evidence/non_clearing/templates/production-source-probes/production-governance-release-source.template.json",
}

PROOF_INPUTS = {
    "production_paid_billing_lifecycle": {
        "missing_input": "SANITIZED_LIVE_BILLING_PROOF_JSON",
        "proof_template_ref": TEMPLATE_REFS["billing_live_proof_template"],
        "source_template_ref": TEMPLATE_REFS["billing_source_template"],
        "source_probe_command": (
            "python3 scripts/stage1_production_source_probe.py --billing "
            "--release-sha $(git rev-parse HEAD) "
            "--billing-proof <sanitized-live-billing-proof.json> "
            "--write-canonical-source"
        ),
    },
    "production_security_launch_checks": {
        "missing_input": "SANITIZED_PRODUCTION_SECURITY_PROOF_JSON",
        "proof_template_ref": TEMPLATE_REFS["security_proof_template"],
        "source_template_ref": TEMPLATE_REFS["security_source_template"],
        "source_probe_command": (
            "python3 scripts/stage1_production_source_probe.py --security "
            "--release-sha $(git rev-parse HEAD) "
            "--security-proof <sanitized-production-security-proof.json> "
            "--write-canonical-source"
        ),
    },
    "production_legal_support_policy": {
        "missing_input": "PRODUCTION_WEB_URL",
        "proof_template_ref": None,
        "source_template_ref": TEMPLATE_REFS["legal_support_source_template"],
        "source_probe_command": (
            "python3 scripts/stage1_production_source_probe.py --legal-support "
            "--release-sha $(git rev-parse HEAD) "
            "--production-web-url https://zenari.ai "
            "--write-canonical-source"
        ),
    },
    "production_governance_release": {
        "missing_input": "SANITIZED_PRODUCTION_GOVERNANCE_PROOF_JSON",
        "proof_template_ref": TEMPLATE_REFS["governance_proof_template"],
        "source_template_ref": TEMPLATE_REFS["governance_source_template"],
        "source_probe_command": (
            "python3 scripts/stage1_production_source_probe.py --governance "
            "--release-sha $(git rev-parse HEAD) "
            "--governance-proof <sanitized-production-governance-proof.json> "
            "--write-canonical-source"
        ),
    },
}

PROOF_BUNDLE_ENV_INPUTS = {
    "production_dns": [
        "PRODUCTION_WEB_URL",
        "PRODUCTION_DNS_TARGET",
        "CLOUDFLARE_ZONE_ID or CF_ZONE_ID",
        "CLOUDFLARE_API_TOKEN or CF_API_TOKEN",
    ],
    "billing": [
        "STRIPE_MODE=live",
        "STRIPE_SECRET_KEY or STRIPE_API_KEY with live key shape",
        "STRIPE_PUBLISHABLE_KEY or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY with live key shape when set",
        "STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID",
        "STAGE1_PROD_BILLING_CHECKOUT_CUSTOMER_ID",
        "STAGE1_PROD_BILLING_PRICE_ID",
        "STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_ID",
        "STAGE1_PROD_BILLING_ACTIVE_CUSTOMER_ID",
        "STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_STATUS",
        "STAGE1_PROD_BILLING_PAST_DUE_SUBSCRIPTION_ID",
        "STAGE1_PROD_BILLING_PAST_DUE_INVOICE_ID",
        "STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_ID",
        "STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_STATUS",
        "STAGE1_PROD_BILLING_SEAT_QUANTITY",
        "STAGE1_PROD_BILLING_SYNCED_QUANTITY",
        "STAGE1_PROD_BILLING_SUBSCRIPTION_ITEM_ID",
        "STAGE1_PROD_BILLING_PRORATION_BEHAVIOR",
        "STAGE1_PROD_BILLING_SYNC_IDEMPOTENCY_KEY",
        "STAGE1_PROD_BILLING_VISIBLE_INVOICE_ID",
        "STAGE1_PROD_BILLING_REFUND_STATUS",
        "STAGE1_PROD_BILLING_ADMIN_OPERATION",
        "STAGE1_PROD_BILLING_REFUND_CHARGE_ID",
        "STAGE1_PROD_BILLING_REFUND_ID",
        "STAGE1_PROD_BILLING_QUOTA_RESET_INVOICE_ID",
        "STAGE1_PROD_BILLING_WEBHOOK_EVENT_IDS",
        "STAGE1_PROD_BILLING_FIRST_DELIVERY_MUTATIONS",
        "STAGE1_PROD_BILLING_REPLAY_DELIVERY_MUTATIONS",
        "STAGE1_PROD_BILLING_DUPLICATE_MUTATION_COUNT",
        "STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_ID",
        "STAGE1_PROD_BILLING_LIVE_TEST_SEPARATION_REF",
        "STAGE1_PROD_BILLING_PAID_CHECKOUT_REF",
        "STAGE1_PROD_BILLING_SUBSCRIPTION_ACTIVE_REF",
        "STAGE1_PROD_BILLING_SUBSCRIPTION_PAST_DUE_REF",
        "STAGE1_PROD_BILLING_SUBSCRIPTION_CANCEL_REF",
        "STAGE1_PROD_BILLING_TEAM_SEAT_REF",
        "STAGE1_PROD_BILLING_INVOICE_VISIBILITY_REF",
        "STAGE1_PROD_BILLING_LIFECYCLE_AUDIT_REF",
        "STAGE1_PROD_BILLING_REFUND_CREDIT_REF",
        "STAGE1_PROD_BILLING_QUOTA_RESET_REF",
        "STAGE1_PROD_BILLING_WEBHOOK_IDEMPOTENCY_REF",
        "STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_REF",
        "STAGE1_PROD_BILLING_QUOTA_PROJECTION_REF",
        "STAGE1_PROD_BILLING_REFUND_WEBHOOK_AUDIT_REF",
    ],
    "security": [
        "STAGE1_PROD_SECURITY_SAME_SITE",
        "STAGE1_PROD_SECURITY_RAW_SECRET_EXPOSURE_COUNT",
        "STAGE1_PROD_SECURITY_FRONTEND_SECRET_EXPOSURE_COUNT",
        "STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF",
        "STAGE1_PROD_SECURITY_CSRF_SAME_SITE_REF",
        "STAGE1_PROD_SECURITY_SECRET_REDACTION_REF",
        "STAGE1_PROD_SECURITY_ADMIN_SURFACE_PRIVACY_REF",
        "STAGE1_PROD_SECURITY_PROVIDER_KEY_CONTAINMENT_REF",
        "STAGE1_PROD_SECURITY_STRIPE_LIVE_TEST_SEPARATION_REF",
        "STAGE1_PROD_SECURITY_RATE_LIMIT_SPEND_CAP_REF",
        "STAGE1_PROD_SECURITY_CSP_HEADERS_REF",
        "STAGE1_PROD_SECURITY_RBAC_TENANT_ISOLATION_REF",
        "STAGE1_PROD_SECURITY_AUDIT_REF",
    ],
    "governance": [
        "STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS",
        "STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_REFS",
        "STAGE1_PROD_GOVERNANCE_ACTIVATION_HIGH_RISK_RBAC_REF",
        "STAGE1_PROD_GOVERNANCE_ACTIVATION_REVIEWER_RATIONALE_REF",
        "STAGE1_PROD_GOVERNANCE_ACTIVATION_SECOND_REVIEW_REF",
        "STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_IMMUTABILITY_REF",
        "STAGE1_PROD_GOVERNANCE_ACTIVATION_GATES_REF",
        "STAGE1_PROD_GOVERNANCE_ABUSE_RUNTIME_REQUEST_IDS",
        "STAGE1_PROD_GOVERNANCE_ABUSE_AUDIT_REFS",
        "STAGE1_PROD_GOVERNANCE_ABUSE_ACCOUNT_HOLD_REF",
        "STAGE1_PROD_GOVERNANCE_ABUSE_RATE_LIMIT_REF",
        "STAGE1_PROD_GOVERNANCE_ABUSE_SPEND_CAP_OR_KILL_SWITCH_REF",
        "STAGE1_PROD_GOVERNANCE_ABUSE_RBAC_AUDIT_REF",
        "STAGE1_PROD_GOVERNANCE_SKILL_RUNTIME_REQUEST_IDS",
        "STAGE1_PROD_GOVERNANCE_SKILL_AUDIT_REFS",
        "STAGE1_PROD_GOVERNANCE_SKILL_OWNER_ID",
        "STAGE1_PROD_GOVERNANCE_SKILL_RISK_LEVEL",
        "STAGE1_PROD_GOVERNANCE_SKILL_SUITE_ID",
        "STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_ID",
        "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_ID",
        "STAGE1_PROD_GOVERNANCE_SKILL_CANARY_SAMPLE_SIZE",
        "STAGE1_PROD_GOVERNANCE_SKILL_OWNER_RISK_REF",
        "STAGE1_PROD_GOVERNANCE_SKILL_EVAL_SUITE_REF",
        "STAGE1_PROD_GOVERNANCE_SKILL_SAFETY_REFS_REF",
        "STAGE1_PROD_GOVERNANCE_SKILL_CANARY_METRICS_REF",
        "STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_REF",
        "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_REF",
    ],
}

POST_SOURCE_COMMANDS = [
    "python3 scripts/generate_stage1_production_billing_evidence.py --source ops/evidence/production/billing-paid-lifecycle-source.json",
    "python3 scripts/generate_stage1_production_security_launch_evidence.py --source ops/evidence/production/production-security-launch-source.json",
    "python3 scripts/generate_stage1_production_legal_support_evidence.py --source ops/evidence/production/production-legal-support-source.json",
    "python3 scripts/generate_stage1_production_governance_release_evidence.py --source ops/evidence/production/production-governance-release-source.json",
    "python3 scripts/generate_stage1_production_launch_evidence.py",
    "python3 scripts/validate_stage1_production_launch.py",
]


class ProductionLaunchInputPacketError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionLaunchInputPacketError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionLaunchInputPacketError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProductionLaunchInputPacketError(f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def current_release_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def source_requirement_rows(readiness: dict[str, Any]) -> list[dict[str, Any]]:
    rows = readiness.get("production_source_probe_requirements")
    if not isinstance(rows, list):
        handoff = readiness.get("operator_handoff")
        rows = handoff.get("production_source_probe_requirements") if isinstance(handoff, dict) else []
    if not isinstance(rows, list):
        rows = []
    return [dict(row) for row in rows if isinstance(row, dict)]


def template_status() -> dict[str, dict[str, Any]]:
    status: dict[str, dict[str, Any]] = {}
    for key, path_ref in TEMPLATE_REFS.items():
        path = ROOT / path_ref
        template_only = False
        schema_version = "missing"
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                data = {}
            if isinstance(data, dict):
                template_only = data.get("template_only") is True and data.get("status") == "template_only"
                schema_version = str(data.get("schema_version", "missing"))
        status[key] = {
            "path": path_ref,
            "exists": path.exists(),
            "template_only": template_only,
            "schema_version": schema_version,
        }
    return status


def closure_summary(closure: dict[str, Any]) -> dict[str, Any]:
    summary = closure.get("queue_summary")
    if not isinstance(summary, dict):
        return {"status": "missing"}
    return {
        "status": closure.get("status", "missing"),
        "release_gate_decision": closure.get("release_gate_decision", "no_go"),
        "completed": summary.get("completed"),
        "total": summary.get("total"),
        "open": summary.get("open"),
        "completion_percent": summary.get("completion_percent"),
        "open_gates": summary.get("open_gates", []),
    }


def dns_readiness_summary(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "path": display_path(path),
            "status": "missing",
            "first_blocker": "production_dns_readiness_not_written",
        }
    data = read_json(path)
    blockers = string_list(data.get("blocked_checks"))
    doh = data.get("dns_over_https_probe") if isinstance(data.get("dns_over_https_probe"), dict) else {}
    public_addresses = data.get("public_production_addresses_observed")
    return {
        "path": display_path(path),
        "status": data.get("status", "missing"),
        "dns_split_brain_observed": data.get("dns_split_brain_observed") is True,
        "public_production_address_count": len(public_addresses) if isinstance(public_addresses, list) else 0,
        "doh_probe_statuses": {
            key: str(value.get("status", "missing"))
            for key, value in doh.items()
            if isinstance(value, dict)
            and key
            in {
                "production_a_cloudflare",
                "production_aaaa_cloudflare",
                "production_a_google",
                "production_aaaa_google",
                "staging_a_cloudflare",
                "staging_a_google",
            }
        },
        "first_blocker": blockers[0] if blockers else "not reported",
    }


def proof_bundle_summary(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "path": display_path(path),
            "status": "missing",
            "release_gate_decision": "no_go",
            "first_blockers": ["production_proof_bundle_not_written"],
            "canonical_sources_requested": False,
            "pipeline_status": "missing",
        }
    data = read_json(path)
    blockers = string_list(data.get("blocked_checks"))
    pipeline = data.get("pipeline_summary") if isinstance(data.get("pipeline_summary"), dict) else {}
    proofs = data.get("proofs") if isinstance(data.get("proofs"), dict) else {}
    coverage = data.get("input_variable_coverage") if isinstance(data.get("input_variable_coverage"), dict) else {}
    coverage_groups = coverage.get("groups") if isinstance(coverage.get("groups"), dict) else {}
    return {
        "path": display_path(path),
        "status": data.get("status", "missing"),
        "release_gate_decision": data.get("release_gate_decision", "no_go"),
        "canonical_sources_requested": data.get("canonical_sources_requested") is True,
        "first_blockers": blockers[:6] or ["not reported"],
        "input_variable_coverage": {
            "required_total": coverage.get("required_total", 0),
            "required_configured": coverage.get("required_configured", 0),
            "required_missing": coverage.get("required_missing", 0),
            "required_invalid": coverage.get("required_invalid", 0),
            "blocking_input_count": coverage.get("blocking_input_count", 0),
            "required_completion_percent": coverage.get("required_completion_percent", 0),
            "first_missing_or_invalid_inputs": string_list(coverage.get("first_missing_or_invalid_inputs"))[:12],
            "groups": {
                group: {
                    "required_total": value.get("required_total", 0),
                    "required_configured": value.get("required_configured", 0),
                    "required_missing": value.get("required_missing", 0),
                    "required_invalid": value.get("required_invalid", 0),
                }
                for group, value in coverage_groups.items()
                if isinstance(value, dict)
            },
        },
        "billing_status": proofs.get("billing", {}).get("status") if isinstance(proofs.get("billing"), dict) else "missing",
        "security_status": proofs.get("security", {}).get("status") if isinstance(proofs.get("security"), dict) else "missing",
        "governance_status": proofs.get("governance", {}).get("status") if isinstance(proofs.get("governance"), dict) else "missing",
        "pipeline_status": pipeline.get("status", "missing"),
    }


def build_packet(readiness: dict[str, Any], closure: dict[str, Any]) -> dict[str, Any]:
    readiness_handoff = readiness.get("operator_handoff")
    missing_variables = (
        readiness_handoff.get("missing_variables", [])
        if isinstance(readiness_handoff, dict) and isinstance(readiness_handoff.get("missing_variables"), list)
        else []
    )
    source_inputs: list[dict[str, Any]] = []
    source_commands: list[str] = []
    for row in source_requirement_rows(readiness):
        probe_id = str(row.get("probe_id", ""))
        proof = PROOF_INPUTS.get(probe_id, {})
        diagnostic = row.get("diagnostic") if isinstance(row.get("diagnostic"), dict) else {}
        blockers = string_list(diagnostic.get("blockers")) or string_list(diagnostic.get("blocked_checks"))
        supporting = row.get("supporting_diagnostics") if isinstance(row.get("supporting_diagnostics"), list) else []
        supporting_first_blocker = ""
        for item in supporting:
            if not isinstance(item, dict):
                continue
            if item.get("status") == "blocked" and str(item.get("first_blocker", "")).strip():
                supporting_first_blocker = str(item["first_blocker"]).strip()
                break
        first_blocker = str(
            supporting_first_blocker or diagnostic.get("first_blocker", "") or row.get("current_blocker", "")
        ).strip()
        source_commands.append(str(proof.get("source_probe_command", "")))
        source_inputs.append(
            {
                "probe_id": probe_id,
                "status": row.get("status", "missing"),
                "source_probe_exists": row.get("source_probe_exists") is True,
                "source_path": row.get("path"),
                "source_schema_version": row.get("schema_version"),
                "diagnostic_path": row.get("diagnostic_path"),
                "current_blocker": row.get("current_blocker"),
                "first_blocker": first_blocker,
                "blockers": blockers[:6],
                "missing_input": proof.get("missing_input", "unknown"),
                "proof_template_ref": proof.get("proof_template_ref"),
                "source_template_ref": proof.get("source_template_ref"),
                "source_probe_command": proof.get("source_probe_command"),
                "evidence_generator": row.get("generator"),
                "strict_validator": row.get("strict_validator"),
                "supporting_diagnostics": supporting_diagnostics_for(probe_id),
            }
        )

    data: dict[str, Any] = {
        "schema_version": "stage1.production_launch_input_packet.v1",
        "environment": "production",
        "kind": "stage1_production_launch_input_packet",
        "status": "blocked",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "release_sha": current_release_sha(),
        "non_clearing_input_packet": True,
        "canonical_pass_path": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "source_readiness_ref": display_path(DEFAULT_READINESS),
        "closure_queue_ref": display_path(DEFAULT_CLOSURE_QUEUE),
        "closure_summary": closure_summary(closure),
        "production_dns_readiness": dns_readiness_summary(DEFAULT_DNS_READINESS),
        "proof_bundle": {
            "summary": proof_bundle_summary(DEFAULT_PROOF_BUNDLE_SUMMARY),
            "runner": "scripts/run_stage1_production_proof_bundle.py",
            "validator": "scripts/validate_stage1_production_proof_bundle.py",
            "required_env_variable_groups": PROOF_BUNDLE_ENV_INPUTS,
            "operator_commands": {
                "non_clearing_preflight": [
                    "python3 scripts/run_stage1_production_proof_bundle.py || test $? -eq 2",
                    "python3 scripts/validate_stage1_production_proof_bundle.py",
                ],
                "canonical_after_real_production_inputs_pass": [
                    "python3 scripts/run_stage1_production_proof_bundle.py --write-canonical-sources",
                    "python3 scripts/validate_stage1_production_launch.py",
                ],
            },
            "canonical_write_policy": (
                "Use --write-canonical-sources only after production DNS/HTTPS, live Stripe billing, "
                "production security, and production governance proofs are real and pass their strict validators."
            ),
        },
        "template_refs": template_status(),
        "missing_variables": missing_variables,
        "source_inputs": source_inputs,
        "execution_order": {
            "generate_templates": [
                "python3 scripts/stage1_billing_live_proof_template.py --output ops/evidence/non_clearing/templates/billing-live-proof.template.json --self-test",
                "python3 scripts/generate_stage1_production_source_probe_templates.py --output-dir ops/evidence/non_clearing/templates/production-source-probes --self-test",
                "python3 scripts/validate_stage1_production_source_probe_templates.py --template-dir ops/evidence/non_clearing/templates/production-source-probes",
            ],
            "run_one_shot_proof_bundle_preflight": [
                "python3 scripts/run_stage1_production_proof_bundle.py || test $? -eq 2",
                "python3 scripts/validate_stage1_production_proof_bundle.py",
            ],
            "write_canonical_sources_after_real_inputs": [cmd for cmd in source_commands if cmd],
            "generate_and_validate_after_sources": POST_SOURCE_COMMANDS,
        },
        "gate_impact": {
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
            "can_clear_billing": False,
            "can_clear_security": False,
            "can_clear_legal_support": False,
            "can_clear_governance": False,
            "can_clear_aggregate_production_gate": False,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def supporting_diagnostics_for(probe_id: str) -> list[str]:
    if probe_id == "production_paid_billing_lifecycle":
        return [display_path(DEFAULT_BILLING_OPERATOR_PACKET)]
    if probe_id == "production_security_launch_checks":
        return [display_path(DEFAULT_SECURITY_OPERATOR_PACKET)]
    if probe_id == "production_legal_support_policy":
        return [
            display_path(DEFAULT_DNS_READINESS),
            display_path(DEFAULT_LEGAL_SUPPORT_OPERATOR_PACKET),
        ]
    if probe_id == "production_governance_release":
        return [display_path(DEFAULT_GOVERNANCE_OPERATOR_PACKET)]
    return []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--readiness", type=Path, default=DEFAULT_READINESS)
    parser.add_argument("--closure-queue", type=Path, default=DEFAULT_CLOSURE_QUEUE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if set(PROOF_INPUTS) != {
            "production_paid_billing_lifecycle",
            "production_security_launch_checks",
            "production_legal_support_policy",
            "production_governance_release",
        }:
            raise SystemExit("production launch input packet proof input contract mismatch")
        if not POST_SOURCE_COMMANDS or not TEMPLATE_REFS:
            raise SystemExit("production launch input packet command/template contract incomplete")
        print("stage1 production launch input packet generator contract passed")
        return 0

    readiness = read_json(args.readiness)
    closure = read_json(args.closure_queue)
    packet = build_packet(readiness, closure)
    write_json(args.output, packet)
    print(f"wrote Stage 1 production launch input packet to {display_path(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
