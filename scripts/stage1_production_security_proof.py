#!/usr/bin/env python3
"""Assemble sanitized Stage 1 production security proof input.

The output is consumed by ``scripts/stage1_production_source_probe.py
--security``. This helper does not run authenticated probes itself; it converts
operator-supplied production runtime/audit references into a safe proof shape.
When required production refs are missing it writes a non-clearing blocked
diagnostic and exits 2.
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
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.candidate.json"
DEFAULT_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.blocked.json"
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
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
    "download_url",
    "signed_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|"
    r"t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)

SECTION_REF_ARGS = {
    "secure_session_cookie": "secure_session_cookie_ref",
    "csrf_same_site_enforcement": "csrf_same_site_ref",
    "secret_exposure_redaction": "secret_redaction_ref",
    "admin_surface_privacy": "admin_surface_privacy_ref",
    "provider_key_containment": "provider_key_containment_ref",
    "stripe_live_test_separation": "stripe_live_test_separation_ref",
    "rate_limit_spend_cap": "rate_limit_spend_cap_ref",
    "csp_headers": "csp_headers_ref",
    "rbac_tenant_isolation": "rbac_tenant_isolation_ref",
}


class ProductionSecurityProofError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionSecurityProofError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionSecurityProofError(f"{path} contains raw secret-looking material")


def current_release_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip().lower() if result.returncode == 0 else ""


def require_release_sha(raw: str) -> str:
    value = raw.strip().lower()
    if not RELEASE_SHA_RE.fullmatch(value):
        raise ProductionSecurityProofError("release_sha_missing_or_not_full_sha")
    return value


def clean_ref(value: str, field: str) -> str:
    candidate = value.strip()
    if not candidate:
        raise ProductionSecurityProofError(f"{field}_missing")
    if RAW_SECRET_RE.search(candidate):
        raise ProductionSecurityProofError(f"{field}_contains_secret_shaped_material")
    return candidate


def collect_ref_blockers(value: str, field: str) -> list[str]:
    candidate = value.strip()
    if not candidate:
        return [f"{field}_missing"]
    if RAW_SECRET_RE.search(candidate):
        return [f"{field}_contains_secret_shaped_material"]
    return []


def require_zero(value: str, field: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ProductionSecurityProofError(f"{field}_must_be_integer") from exc
    if parsed != 0:
        raise ProductionSecurityProofError(f"{field}_must_be_zero")
    return parsed


def collect_zero_blockers(value: str, field: str) -> list[str]:
    try:
        parsed = int(value)
    except ValueError:
        return [f"{field}_must_be_integer"]
    if parsed != 0:
        return [f"{field}_must_be_zero"]
    return []


def section(ref: str, **values: Any) -> dict[str, Any]:
    return {"status": "pass", "evidence_refs": [ref], **values}


def audit_section(ref: str) -> dict[str, Any]:
    return {"status": "pass", "refs": [ref]}


def collect_blockers(args: argparse.Namespace) -> list[str]:
    blockers: list[str] = []
    try:
        require_release_sha(args.release_sha or current_release_sha())
    except ProductionSecurityProofError as exc:
        blockers.append(str(exc))
    same_site = args.same_site.strip().lower()
    if same_site not in {"lax", "strict"}:
        blockers.append("same_site_must_be_lax_or_strict")
    blockers.extend(collect_zero_blockers(args.raw_secret_exposure_count, "raw_secret_exposure_count"))
    blockers.extend(collect_zero_blockers(args.frontend_secret_exposure_count, "frontend_secret_exposure_count"))
    for arg_name in SECTION_REF_ARGS.values():
        blockers.extend(collect_ref_blockers(getattr(args, arg_name), arg_name))
    blockers.extend(collect_ref_blockers(args.audit_ref, "audit_ref"))
    return blockers


def build_proof(args: argparse.Namespace) -> dict[str, Any]:
    release_sha = require_release_sha(args.release_sha or current_release_sha())
    same_site = args.same_site.strip().lower()
    if same_site not in {"lax", "strict"}:
        raise ProductionSecurityProofError("same_site_must_be_lax_or_strict")
    raw_secret_count = require_zero(args.raw_secret_exposure_count, "raw_secret_exposure_count")
    frontend_secret_count = require_zero(args.frontend_secret_exposure_count, "frontend_secret_exposure_count")
    refs = {
        section_name: clean_ref(getattr(args, arg_name), arg_name)
        for section_name, arg_name in SECTION_REF_ARGS.items()
    }
    audit_ref = clean_ref(args.audit_ref, "audit_ref")
    proof: dict[str, Any] = {
        "schema_version": "stage1.production_security_proof.v1",
        "environment": "production",
        "kind": "production_security_launch_proof",
        "status": "pass",
        "release_sha": release_sha,
        "generated_at": now(),
        "secure_session_cookie": section(
            refs["secure_session_cookie"],
            http_only=True,
            secure=True,
            same_site=same_site,
        ),
        "csrf_same_site_enforcement": section(
            refs["csrf_same_site_enforcement"],
            cross_site_mutations_denied=True,
        ),
        "secret_exposure_redaction": section(
            refs["secret_exposure_redaction"],
            raw_secret_exposure_count=raw_secret_count,
        ),
        "admin_surface_privacy": section(
            refs["admin_surface_privacy"],
            raw_private_payload_visible=False,
        ),
        "provider_key_containment": section(
            refs["provider_key_containment"],
            frontend_secret_exposure_count=frontend_secret_count,
        ),
        "stripe_live_test_separation": section(
            refs["stripe_live_test_separation"],
            live_mode_isolated=True,
        ),
        "rate_limit_spend_cap": section(
            refs["rate_limit_spend_cap"],
            kill_switch_ready=True,
        ),
        "csp_headers": section(
            refs["csp_headers"],
            csp_present=True,
        ),
        "rbac_tenant_isolation": section(
            refs["rbac_tenant_isolation"],
            cross_tenant_denials=True,
        ),
        "audit_refs": audit_section(audit_ref),
    }
    proof.update(SAFE_FALSE_FIELDS)
    assert_no_secret(proof, "production_security_proof")
    return proof


def blocked_diagnostic(blockers: list[str], release_sha: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": "stage1.production_security_proof.blocked.v1",
        "environment": "production",
        "kind": "production_security_launch_proof",
        "status": "blocked",
        "release_sha": release_sha if RELEASE_SHA_RE.fullmatch(release_sha or "") else None,
        "generated_at": now(),
        "canonical_source_written": False,
        "blocked_checks": blockers,
        "operator_next_command_after_pass": (
            "python3 scripts/stage1_production_source_probe.py --security "
            "--release-sha $(git rev-parse HEAD) --security-proof <this-proof.json> "
            "--write-canonical-source"
        ),
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--release-sha", default="")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--diagnostic", type=Path, default=DEFAULT_DIAGNOSTIC)
    parser.add_argument("--same-site", default="lax")
    parser.add_argument("--raw-secret-exposure-count", default="0")
    parser.add_argument("--frontend-secret-exposure-count", default="0")
    parser.add_argument("--secure-session-cookie-ref", default="")
    parser.add_argument("--csrf-same-site-ref", default="")
    parser.add_argument("--secret-redaction-ref", default="")
    parser.add_argument("--admin-surface-privacy-ref", default="")
    parser.add_argument("--provider-key-containment-ref", default="")
    parser.add_argument("--stripe-live-test-separation-ref", default="")
    parser.add_argument("--rate-limit-spend-cap-ref", default="")
    parser.add_argument("--csp-headers-ref", default="")
    parser.add_argument("--rbac-tenant-isolation-ref", default="")
    parser.add_argument("--audit-ref", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if set(SECTION_REF_ARGS) != {
            "secure_session_cookie",
            "csrf_same_site_enforcement",
            "secret_exposure_redaction",
            "admin_surface_privacy",
            "provider_key_containment",
            "stripe_live_test_separation",
            "rate_limit_spend_cap",
            "csp_headers",
            "rbac_tenant_isolation",
        }:
            raise SystemExit("production security proof contract mismatch")
        print("stage1 production security proof contract passed")
        return 0
    release_sha = args.release_sha or current_release_sha()
    blockers = collect_blockers(args)
    if blockers:
        diagnostic = blocked_diagnostic(blockers, release_sha.strip().lower())
        assert_no_secret(diagnostic, "production_security_proof_diagnostic")
        write_json(args.diagnostic, diagnostic)
        print(f"stage1 production security proof blocked: {blockers[0]} (+{len(blockers) - 1} more)" if len(blockers) > 1 else f"stage1 production security proof blocked: {blockers[0]}", file=sys.stderr)
        return 2
    try:
        proof = build_proof(args)
    except ProductionSecurityProofError as exc:
        diagnostic = blocked_diagnostic([str(exc)], release_sha.strip().lower())
        assert_no_secret(diagnostic, "production_security_proof_diagnostic")
        write_json(args.diagnostic, diagnostic)
        print(f"stage1 production security proof blocked: {exc}", file=sys.stderr)
        return 2
    write_json(args.output, proof)
    print(f"wrote Stage 1 production security proof to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
