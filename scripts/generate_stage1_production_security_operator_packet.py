#!/usr/bin/env python3
"""Generate a non-clearing production security operator packet.

The packet converts the production security launch blocker into exact runtime
and audit inputs for ``stage1_production_security_proof.py`` and the follow-up
source/evidence commands. It never persists cookies, authorization headers,
secrets, raw payloads, database URLs, or signed URLs.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-operator-packet.json"
DEFAULT_PROOF_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.blocked.json"
DEFAULT_PROOF_CANDIDATE = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.candidate.json"
DEFAULT_SOURCE_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.security.json"
DEFAULT_SOURCE = ROOT / "ops" / "evidence" / "production" / "production-security-launch-source.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "20260527T1700Z-security-launch-checks.json"

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

SECURITY_REQUIREMENTS = [
    {
        "section": "secure_session_cookie",
        "flag": "--secure-session-cookie-ref",
        "required_runtime_assertions": {"http_only": True, "secure": True, "same_site": "lax_or_strict"},
    },
    {
        "section": "csrf_same_site_enforcement",
        "flag": "--csrf-same-site-ref",
        "required_runtime_assertions": {"cross_site_mutations_denied": True},
    },
    {
        "section": "secret_exposure_redaction",
        "flag": "--secret-redaction-ref",
        "required_runtime_assertions": {"raw_secret_exposure_count": 0},
    },
    {
        "section": "admin_surface_privacy",
        "flag": "--admin-surface-privacy-ref",
        "required_runtime_assertions": {"raw_private_payload_visible": False},
    },
    {
        "section": "provider_key_containment",
        "flag": "--provider-key-containment-ref",
        "required_runtime_assertions": {"frontend_secret_exposure_count": 0},
    },
    {
        "section": "stripe_live_test_separation",
        "flag": "--stripe-live-test-separation-ref",
        "required_runtime_assertions": {"live_mode_isolated": True},
    },
    {
        "section": "rate_limit_spend_cap",
        "flag": "--rate-limit-spend-cap-ref",
        "required_runtime_assertions": {"kill_switch_ready": True},
    },
    {
        "section": "csp_headers",
        "flag": "--csp-headers-ref",
        "required_runtime_assertions": {"csp_present": True},
    },
    {
        "section": "rbac_tenant_isolation",
        "flag": "--rbac-tenant-isolation-ref",
        "required_runtime_assertions": {"cross_tenant_denials": True},
    },
    {
        "section": "audit_refs",
        "flag": "--audit-ref",
        "required_runtime_assertions": {"audit_ref_present": True},
    },
]

SECURITY_ENV_VARIABLES = [
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
]


class SecurityOperatorPacketError(Exception):
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
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        raise SecurityOperatorPacketError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise SecurityOperatorPacketError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise SecurityOperatorPacketError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise SecurityOperatorPacketError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "security_operator_packet")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


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


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def first_blocker(data: dict[str, Any]) -> str:
    blockers = string_list(data.get("blocked_checks")) or string_list(data.get("blockers"))
    return blockers[0] if blockers else "not reported"


def diagnostic_summary(path: Path, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": display_path(path),
        "exists": path.exists(),
        "status": data.get("status", "missing") if data else "missing",
        "first_blocker": first_blocker(data) if data else "diagnostic_not_written",
        "canonical_source_written": data.get("canonical_source_written") is True if data else False,
    }


def proof_command(output_path: Path) -> list[str]:
    command = [
        "python3 scripts/stage1_production_security_proof.py",
        "--release-sha $(git rev-parse HEAD)",
        f"--output {display_path(output_path)}",
        "--same-site lax",
        "--raw-secret-exposure-count 0",
        "--frontend-secret-exposure-count 0",
    ]
    command.extend(f"{item['flag']} <production-runtime-or-audit-ref>" for item in SECURITY_REQUIREMENTS)
    return command


def private_env_template() -> dict[str, Any]:
    return {
        "path_placeholder": "<private-production-env>",
        "gitignore_required": True,
        "blank_values_only": True,
        "allowed_variable_names": SECURITY_ENV_VARIABLES,
        "template_lines": [f"{name}=" for name in SECURITY_ENV_VARIABLES],
    }


def operator_command_packet(args: argparse.Namespace) -> list[dict[str, Any]]:
    return [
        {
            "step_id": "run_private_env_proof_bundle",
            "command": "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
            "side_effect": "non-clearing proof candidates and blocked diagnostics only",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_security_candidate_or_diagnostic",
            "command": f"python3 scripts/validate_stage1_production_security_proof.py --proof {display_path(args.proof_candidate)} --diagnostic {display_path(args.proof_diagnostic)}",
            "side_effect": "local validation only",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "run_security_source_probe_after_candidate_passes",
            "command": (
                "python3 scripts/stage1_production_source_probe.py --security "
                "--release-sha $(git rev-parse HEAD) "
                f"--security-proof {display_path(args.proof_candidate)} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.security.json "
                "--write-canonical-source"
            ),
            "side_effect": "writes security canonical source only after production security proof passes",
            "may_write_canonical_source": True,
            "requires_review": True,
        },
        {
            "step_id": "generate_strict_security_evidence",
            "command": "python3 scripts/generate_stage1_production_security_launch_evidence.py --source ops/evidence/production/production-security-launch-source.json",
            "side_effect": "writes strict production security evidence from canonical source",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_strict_security_evidence",
            "command": "python3 scripts/validate_stage1_production_security_launch_evidence.py",
            "side_effect": "strict production security validation",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "refresh_non_clearing_summary",
            "command": "python3 scripts/refresh_stage1_production_non_clearing_evidence.py || test $? -eq 2",
            "side_effect": "non-clearing summary refresh",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
    ]


def build_packet(args: argparse.Namespace) -> dict[str, Any]:
    proof_diagnostic = load_json(args.proof_diagnostic)
    source_diagnostic = load_json(args.source_diagnostic)
    data: dict[str, Any] = {
        "schema_version": "stage1.production_security_operator_packet.v1",
        "environment": "production",
        "kind": "stage1_production_security_operator_packet",
        "status": "blocked",
        "release_gate_check_id": "production_security_launch_checks",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "release_sha": current_release_sha(),
        "non_clearing_operator_packet": True,
        "canonical_pass_path": False,
        "can_clear_production_security_launch_checks": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "required_security_runtime_refs": SECURITY_REQUIREMENTS,
        "private_env_template": private_env_template(),
        "proof": {
            "candidate_path": display_path(args.proof_candidate),
            "blocked_diagnostic": diagnostic_summary(args.proof_diagnostic, proof_diagnostic),
            "proof_generator_command": " ".join(proof_command(args.proof_candidate)),
            "proof_validator_command": (
                f"python3 scripts/validate_stage1_production_security_proof.py "
                f"--proof {display_path(args.proof_candidate)}"
            ),
        },
        "source_probe": {
            "canonical_source_path": display_path(args.source),
            "canonical_source_exists": args.source.exists(),
            "source_diagnostic": diagnostic_summary(args.source_diagnostic, source_diagnostic),
            "source_probe_command": (
                "python3 scripts/stage1_production_source_probe.py --security "
                "--release-sha $(git rev-parse HEAD) "
                f"--security-proof {display_path(args.proof_candidate)} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.security.json "
                "--write-canonical-source"
            ),
        },
        "operator_command_packet": operator_command_packet(args),
        "blocked_until": [
            "production runtime evidence ref proves secure HttpOnly session cookie with SameSite lax/strict",
            "production runtime evidence ref proves CSRF/same-site mutation denial",
            "production runtime evidence ref proves zero raw secret exposure",
            "production runtime evidence ref proves admin privacy projections hide raw private payloads",
            "production runtime evidence ref proves provider keys are not exposed to frontend/user/export/support surfaces",
            "production runtime evidence ref proves Stripe live/test separation",
            "production runtime evidence ref proves rate limit, spend cap, and kill switch readiness",
            "production runtime evidence ref proves CSP header presence",
            "production runtime evidence ref proves RBAC tenant isolation cross-tenant denials",
            "stage1_production_source_probe.py --security writes ops/evidence/production/production-security-launch-source.json",
            "generate_stage1_production_security_launch_evidence.py writes strict production security evidence",
            "validate_stage1_production_security_launch_evidence.py passes without --allow-preflight",
        ],
        "execution_order": [
            " ".join(proof_command(args.proof_candidate)),
            f"python3 scripts/validate_stage1_production_security_proof.py --proof {display_path(args.proof_candidate)}",
            (
                "python3 scripts/stage1_production_source_probe.py --security "
                "--release-sha $(git rev-parse HEAD) "
                f"--security-proof {display_path(args.proof_candidate)} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.security.json "
                "--write-canonical-source"
            ),
            "python3 scripts/generate_stage1_production_security_launch_evidence.py --source ops/evidence/production/production-security-launch-source.json",
            "python3 scripts/validate_stage1_production_security_launch_evidence.py",
            "python3 scripts/generate_stage1_production_launch_evidence.py",
            "python3 scripts/validate_stage1_production_launch.py",
        ],
        "evidence_outputs": {
            "proof_candidate": display_path(args.proof_candidate),
            "proof_diagnostic": display_path(args.proof_diagnostic),
            "source": display_path(args.source),
            "source_diagnostic": display_path(args.source_diagnostic),
            "security_launch": display_path(args.evidence),
        },
        "gate_impact": {
            "preserved_release_gate_check_id": "production_security_launch_checks",
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
            "can_clear_security_launch_check": False,
            "can_clear_aggregate_production_gate": False,
            "can_clear_stage1_production_launch_gate": False,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof-diagnostic", type=Path, default=DEFAULT_PROOF_DIAGNOSTIC)
    parser.add_argument("--proof-candidate", type=Path, default=DEFAULT_PROOF_CANDIDATE)
    parser.add_argument("--source-diagnostic", type=Path, default=DEFAULT_SOURCE_DIAGNOSTIC)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if len(SECURITY_REQUIREMENTS) != 10:
            raise SystemExit("production security operator packet requirements contract mismatch")
        if len(SECURITY_ENV_VARIABLES) != 13:
            raise SystemExit("production security operator packet private env contract mismatch")
        print("stage1 production security operator packet generator contract passed")
        return 0
    packet = build_packet(args)
    write_json(args.output, packet)
    print(f"wrote Stage 1 production security operator packet to {display_path(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
