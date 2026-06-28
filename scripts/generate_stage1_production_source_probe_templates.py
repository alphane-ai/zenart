#!/usr/bin/env python3
"""Write safe Stage 1 production source-probe templates.

The output files are templates only. They are deliberately named
``*.template.json`` and use ``status=template_only`` so they cannot clear any
production gate. With ``--self-test`` this script feeds the generated templates
to the existing strict production evidence generators and verifies that each
generator exits with blocked diagnostics.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "ops" / "evidence" / "production" / "source-probe-templates"
SYNTHETIC_RELEASE_SHA = "0123456789abcdef0123456789abcdef01234567"
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


def section(name: str, *tokens: str) -> dict[str, Any]:
    return {
        "status": "template_only",
        "required_runtime_proof": name,
        "evidence_refs": [f"replace_me:production/{name}"],
        "required_tokens": list(tokens),
    }


def page_probe(page_id: str, path: str, *tokens: str) -> dict[str, Any]:
    return {
        "page_id": page_id,
        "path": path,
        "status": "template_only",
        "http_status": 200,
        "visibility": "public",
        "external_user_visible": True,
        "admin_session_required": False,
        "required_tokens": list(tokens),
        "evidence_refs": [f"replace_me:production/legal-support/{page_id}"],
    }


def template_common(schema_version: str, probe_id: str, release_sha: str, generated_at: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": schema_version,
        "environment": "production",
        "kind": probe_id,
        "status": "template_only",
        "release_sha": release_sha,
        "generated_at": generated_at,
        "template_only": True,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "operator_note": (
            "Replace every replace_me:* evidence ref with sanitized production "
            "runtime/audit evidence, set status fields to pass only after the "
            "runtime probe has actually run, and write the final source JSON to "
            "the required ops/evidence/production/*-source.json path."
        ),
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def billing_template(release_sha: str, generated_at: str) -> dict[str, Any]:
    data = template_common("stage1.production_billing_source.v1", "production_billing_source", release_sha, generated_at)
    data.update(
        {
            "stripe_mode": "live",
            "livemode": True,
            "release_gate_check_id": "production_paid_billing_lifecycle",
            "lifecycle": {
                "stripe_live_test_separation": section("stripe-live-test-separation", "live", "test isolated"),
                "paid_checkout": section("paid-checkout", "checkout", "livemode"),
                "subscription_active": section("subscription-active", "active"),
                "subscription_past_due": section("subscription-past-due", "past_due"),
                "subscription_cancel": section("subscription-cancel", "cancel"),
                "team_seat_quantity_sync": section("team-seat-quantity-sync", "seat", "sync"),
                "invoice_receipt_visibility": section("invoice-receipt-visibility", "invoice", "receipt"),
                "audit_refs": section("billing-lifecycle-audit", "audit"),
            },
            "refund_credit_webhook": {
                "refund_or_credit": section("refund-or-credit", "refund", "credit"),
                "quota_reset": section("quota-reset", "quota", "reset"),
                "webhook_idempotency": section("webhook-idempotency", "webhook", "idempotency"),
                "failed_export_refund": section("failed-export-refund", "failed export", "refund"),
                "quota_projection": section("quota-projection", "quota", "projection"),
                "audit_refs": section("billing-refund-webhook-audit", "audit"),
            },
        }
    )
    return data


def security_template(release_sha: str, generated_at: str) -> dict[str, Any]:
    data = template_common(
        "stage1.production_security_launch_source.v1",
        "production_security_launch_source",
        release_sha,
        generated_at,
    )
    data.update(
        {
            "release_gate_check_id": "production_security_launch_checks",
            "secure_session_cookie": section("secure-session-cookie", "HttpOnly", "Secure", "SameSite"),
            "csrf_same_site_enforcement": section("csrf-same-site-enforcement", "cross-site denied"),
            "secret_exposure_redaction": section("secret-exposure-redaction", "redacted"),
            "admin_surface_privacy": section("admin-surface-privacy", "privacy"),
            "provider_key_containment": section("provider-key-containment", "key containment"),
            "stripe_live_test_separation": section("stripe-live-test-separation", "live", "test isolated"),
            "rate_limit_spend_cap": section("rate-limit-spend-cap", "rate limit", "spend cap"),
            "csp_headers": section("csp-headers", "Content-Security-Policy"),
            "rbac_tenant_isolation": section("rbac-tenant-isolation", "tenant isolation"),
            "audit_refs": section("security-launch-audit", "audit"),
        }
    )
    return data


def proof_section(name: str, *tokens: str, refs_key: str = "evidence_refs", **extra: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "status": "template_only",
        refs_key: [f"replace_me:production/{name}"],
        "required_tokens": list(tokens),
    }
    data.update(extra)
    return data


def security_proof_template(release_sha: str, generated_at: str) -> dict[str, Any]:
    data = template_common(
        "stage1.production_security_proof.template.v1",
        "production_security_launch_proof_template",
        release_sha,
        generated_at,
    )
    data["operator_note"] = (
        "Replace replace_me values with sanitized production security runtime "
        "evidence refs and booleans. Set each section status to pass only after "
        "the production probe actually ran. This is input for "
        "scripts/stage1_production_source_probe.py --security; it is not a "
        "canonical production source file."
    )
    data.update(
        {
            "secure_session_cookie": proof_section(
                "secure-session-cookie",
                "HttpOnly",
                "Secure",
                "SameSite",
                http_only="replace_me:true",
                secure="replace_me:true",
                same_site="replace_me:lax|strict",
            ),
            "csrf_same_site_enforcement": proof_section(
                "csrf-same-site-enforcement",
                "cross-site mutation denied",
                cross_site_mutations_denied="replace_me:true",
            ),
            "secret_exposure_redaction": proof_section(
                "secret-exposure-redaction",
                "redacted",
                raw_secret_exposure_count="replace_me:0",
            ),
            "admin_surface_privacy": proof_section(
                "admin-surface-privacy",
                "privacy",
                raw_private_payload_visible="replace_me:false",
            ),
            "provider_key_containment": proof_section(
                "provider-key-containment",
                "key containment",
                frontend_secret_exposure_count="replace_me:0",
            ),
            "stripe_live_test_separation": proof_section(
                "stripe-live-test-separation",
                "live",
                "test isolated",
                live_mode_isolated="replace_me:true",
            ),
            "rate_limit_spend_cap": proof_section(
                "rate-limit-spend-cap",
                "rate limit",
                "spend cap",
                kill_switch_ready="replace_me:true",
            ),
            "csp_headers": proof_section(
                "csp-headers",
                "Content-Security-Policy",
                csp_present="replace_me:true",
            ),
            "rbac_tenant_isolation": proof_section(
                "rbac-tenant-isolation",
                "tenant isolation",
                cross_tenant_denials="replace_me:true",
            ),
            "audit_refs": proof_section(
                "security-launch-audit",
                "audit",
                refs_key="refs",
            ),
        }
    )
    return data


def legal_support_template(release_sha: str, generated_at: str) -> dict[str, Any]:
    data = template_common(
        "stage1.production_legal_support_source.v1",
        "production_legal_support_source",
        release_sha,
        generated_at,
    )
    data.update(
        {
            "release_gate_check_id": "production_legal_support_policy",
            "legal": {
                "runtime_request_ids": ["replace_me:production-legal-request-id"],
                "audit_refs": ["replace_me:audit://production/legal-support"],
                "page_probes": [
                    page_probe("terms", "/legal/terms", "Terms", "support contact", "AI content"),
                    page_probe("privacy", "/legal/privacy", "Privacy", "data deletion", "support contact"),
                    page_probe("acceptable_use", "/legal/acceptable-use", "Acceptable Use", "abuse", "support contact"),
                    page_probe("ai_content_disclaimer", "/support", "AI content", "responsibility", "review"),
                    page_probe("ip_complaint", "/legal/ip-complaints", "IP complaint", "copyright", "trademark", "takedown"),
                ],
                "coverage": [
                    section("public-legal-pages", "terms", "privacy", "acceptable use"),
                    section("legal-gate-clearance", "external user", "public"),
                ],
            },
            "support_billing": {
                "runtime_request_ids": ["replace_me:production-support-request-id"],
                "audit_refs": ["replace_me:audit://production/support-billing"],
                "page_probes": [
                    page_probe("support_contact", "/support", "support contact", "report problem", "privacy redaction", "escalation"),
                    page_probe("report_problem", "/report-problem", "project", "task", "trace", "export", "quota"),
                    page_probe("billing_policy", "/legal/billing-policy", "billing", "cancellation", "refund", "credit", "quota reset", "past_due"),
                    page_probe("support_sla", "/support", "support SLA", "severity", "response time", "escalation"),
                ],
                "coverage": [
                    section("support-contact", "support"),
                    section("billing-refund-policy", "refund", "cancel"),
                    section("support-sla", "support SLA", "severity", "response time"),
                    section("support-gate-clearance", "external user", "public"),
                ],
                "paid_launch_policy_alignment": {
                    "status": "template_only",
                    "billing_policy_visible": "replace_me:true",
                    "refund_policy_visible": "replace_me:true",
                    "cancellation_policy_visible": "replace_me:true",
                    "support_sla_visible": "replace_me:true",
                    "standalone_production_readiness_claim": "replace_me:false",
                    "evidence_refs": ["replace_me:production/legal-support/paid-launch-policy-alignment"],
                },
            },
        }
    )
    return data


def governance_template(release_sha: str, generated_at: str) -> dict[str, Any]:
    data = template_common(
        "stage1.production_governance_release_source.v1",
        "production_governance_release_source",
        release_sha,
        generated_at,
    )
    data.update(
        {
            "activation": {
                "release_gate_check_id": "production_activation_review_audit",
                "runtime_request_ids": ["replace_me:production-activation-request-id"],
                "audit_refs": ["replace_me:audit://production/activation-review"],
                "high_risk_rbac": section("activation-high-risk-rbac", "rbac"),
                "reviewer_rationale": section("activation-reviewer-rationale", "rationale"),
                "second_review": section("activation-second-review", "second review"),
                "audit_immutability": section("activation-audit-immutability", "immutable"),
                "activation_gates": section("activation-gates", "gate"),
            },
            "abuse": {
                "release_gate_check_id": "production_abuse_throttle_hold",
                "runtime_request_ids": ["replace_me:production-abuse-request-id"],
                "audit_refs": ["replace_me:audit://production/abuse-hold"],
                "account_hold": section("abuse-account-hold", "hold"),
                "rate_limit": section("abuse-rate-limit", "rate limit"),
                "spend_cap_or_kill_switch": section("abuse-spend-cap-kill-switch", "spend cap", "kill switch"),
                "rbac_audit": section("abuse-rbac-audit", "rbac", "audit"),
            },
            "skill": {
                "release_gate_check_id": "production_skill_release_eval_canary",
                "runtime_request_ids": ["replace_me:production-skill-canary-request-id"],
                "audit_refs": ["replace_me:audit://production/skill-canary"],
                "owner_risk": section("skill-owner-risk", "owner", "risk"),
                "eval_suite": section("skill-eval-suite", "eval"),
                "safety_refs": section("skill-safety-refs", "safety"),
                "canary_metrics": section("skill-canary-metrics", "canary"),
                "rollback_target": section("skill-rollback-target", "rollback"),
                "release_notes": section("skill-release-notes", "release notes"),
            },
        }
    )
    return data


def governance_proof_template(release_sha: str, generated_at: str) -> dict[str, Any]:
    data = template_common(
        "stage1.production_governance_proof.template.v1",
        "production_governance_release_proof_template",
        release_sha,
        generated_at,
    )
    data["operator_note"] = (
        "Replace replace_me values with sanitized production governance runtime "
        "request IDs, audit refs, and section evidence. Set each section status "
        "to pass only after the production runtime/audit evidence exists. This "
        "is input for scripts/stage1_production_source_probe.py --governance; "
        "it is not a canonical production source file."
    )
    data.update(
        {
            "activation": {
                "release_gate_check_id": "production_activation_review_audit",
                "runtime_request_ids": ["replace_me:production-activation-request-id"],
                "audit_refs": ["replace_me:audit://production/activation-review"],
                "high_risk_rbac": proof_section("activation-high-risk-rbac", "rbac"),
                "reviewer_rationale": proof_section("activation-reviewer-rationale", "rationale"),
                "second_review": proof_section("activation-second-review", "second review"),
                "audit_immutability": proof_section("activation-audit-immutability", "immutable"),
                "activation_gates": proof_section("activation-gates", "gate"),
            },
            "abuse": {
                "release_gate_check_id": "production_abuse_throttle_hold",
                "runtime_request_ids": ["replace_me:production-abuse-request-id"],
                "audit_refs": ["replace_me:audit://production/abuse-hold"],
                "account_hold": proof_section("abuse-account-hold", "hold"),
                "rate_limit": proof_section("abuse-rate-limit", "rate limit"),
                "spend_cap_or_kill_switch": proof_section("abuse-spend-cap-kill-switch", "spend cap", "kill switch"),
                "rbac_audit": proof_section("abuse-rbac-audit", "rbac", "audit"),
            },
            "skill": {
                "release_gate_check_id": "production_skill_release_eval_canary",
                "runtime_request_ids": ["replace_me:production-skill-canary-request-id"],
                "audit_refs": ["replace_me:audit://production/skill-canary"],
                "owner_risk": proof_section("skill-owner-risk", "owner", "risk"),
                "eval_suite": proof_section("skill-eval-suite", "eval"),
                "safety_refs": proof_section("skill-safety-refs", "safety"),
                "canary_metrics": proof_section("skill-canary-metrics", "canary"),
                "rollback_target": proof_section("skill-rollback-target", "rollback"),
                "release_notes": proof_section("skill-release-notes", "release notes"),
            },
        }
    )
    return data


def templates(release_sha: str, generated_at: str) -> dict[str, dict[str, Any]]:
    return {
        "billing-paid-lifecycle-source.template.json": billing_template(release_sha, generated_at),
        "production-security-launch-source.template.json": security_template(release_sha, generated_at),
        "production-security-proof.template.json": security_proof_template(release_sha, generated_at),
        "production-legal-support-source.template.json": legal_support_template(release_sha, generated_at),
        "production-governance-release-source.template.json": governance_template(release_sha, generated_at),
        "production-governance-proof.template.json": governance_proof_template(release_sha, generated_at),
    }


def assert_template_safe(name: str, data: dict[str, Any]) -> None:
    if data.get("status") in {"pass", "passed"}:
        raise SystemExit(f"{name} template must not use pass status")
    if data.get("template_only") is not True:
        raise SystemExit(f"{name} template must carry template_only=true")
    for key, expected in SAFE_FALSE_FIELDS.items():
        if data.get(key) is not expected:
            raise SystemExit(f"{name} {key} must be {expected}")
    text = json.dumps(data, sort_keys=True)
    if "replace_me:" not in text:
        raise SystemExit(f"{name} must include replace_me placeholders")


def write_templates(output_dir: Path, release_sha: str) -> list[Path]:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name, data in templates(release_sha, generated_at).items():
        assert_template_safe(name, data)
        path = output_dir / name
        path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        written.append(path)
    return written


def run_generator(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def self_test(output_dir: Path, release_sha: str) -> None:
    test_out = output_dir / ".self-test-output"
    test_out.mkdir(parents=True, exist_ok=True)
    generator_checks = [
        [
            sys.executable,
            "scripts/generate_stage1_production_billing_evidence.py",
            "--release-sha",
            release_sha,
            "--source",
            str(output_dir / "billing-paid-lifecycle-source.template.json"),
            "--lifecycle-evidence",
            str(test_out / "billing-lifecycle.json"),
            "--refund-evidence",
            str(test_out / "billing-refund-credit-webhook.json"),
        ],
        [
            sys.executable,
            "scripts/generate_stage1_production_security_launch_evidence.py",
            "--release-sha",
            release_sha,
            "--source",
            str(output_dir / "production-security-launch-source.template.json"),
            "--evidence",
            str(test_out / "production-security-launch.json"),
        ],
        [
            sys.executable,
            "scripts/generate_stage1_production_legal_support_evidence.py",
            "--release-sha",
            release_sha,
            "--source",
            str(output_dir / "production-legal-support-source.template.json"),
            "--legal-evidence",
            str(test_out / "public-legal-policy.json"),
            "--support-evidence",
            str(test_out / "public-support-billing-policy.json"),
        ],
        [
            sys.executable,
            "scripts/generate_stage1_production_governance_release_evidence.py",
            "--release-sha",
            release_sha,
            "--source",
            str(output_dir / "production-governance-release-source.template.json"),
            "--activation-evidence",
            str(test_out / "activation-review-audit.json"),
            "--abuse-evidence",
            str(test_out / "abuse-throttle-hold.json"),
            "--skill-evidence",
            str(test_out / "skill-release-eval-canary.json"),
        ],
    ]
    for command in generator_checks:
        result = run_generator(command)
        if result.returncode != 2:
            detail = (result.stderr or result.stdout).strip()
            raise SystemExit(f"template source unexpectedly cleared or errored ({result.returncode}): {' '.join(command)}\n{detail}")
    probe_checks = [
        [
            sys.executable,
            "scripts/stage1_production_source_probe.py",
            "--security",
            "--release-sha",
            release_sha,
            "--security-proof",
            str(output_dir / "production-security-proof.template.json"),
            "--security-source",
            str(test_out / "production-security-launch-source.json"),
            "--diagnostic",
            str(test_out / "production-security-proof.diagnostic.json"),
            "--write-canonical-source",
        ],
        [
            sys.executable,
            "scripts/stage1_production_source_probe.py",
            "--governance",
            "--release-sha",
            release_sha,
            "--governance-proof",
            str(output_dir / "production-governance-proof.template.json"),
            "--governance-source",
            str(test_out / "production-governance-release-source.json"),
            "--diagnostic",
            str(test_out / "production-governance-proof.diagnostic.json"),
            "--write-canonical-source",
        ],
    ]
    for command in probe_checks:
        result = run_generator(command)
        if result.returncode != 2:
            detail = (result.stderr or result.stdout).strip()
            raise SystemExit(f"template proof unexpectedly cleared or errored ({result.returncode}): {' '.join(command)}\n{detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--release-sha", default=SYNTHETIC_RELEASE_SHA)
    parser.add_argument("--contract-only", action="store_true", help="validate template definitions without writing files")
    parser.add_argument("--self-test", action="store_true", help="verify generated templates cannot clear production generators")
    args = parser.parse_args()

    generated_at = "1970-01-01T00:00:00+00:00"
    for name, data in templates(args.release_sha, generated_at).items():
        assert_template_safe(name, data)
    if args.contract_only:
        print("stage1 production source probe template contract passed")
        return 0

    written = write_templates(args.output_dir, args.release_sha)
    if args.self_test:
        self_test(args.output_dir, args.release_sha)
    print(f"wrote {len(written)} Stage 1 production source probe templates to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
