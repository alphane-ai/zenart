#!/usr/bin/env python3
"""Validate the Stage 1 production security proof helper contract."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "stage1_production_security_proof.py"
SOURCE_PROBE = ROOT / "scripts" / "stage1_production_source_probe.py"
DEFAULT_PROOF = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.candidate.json"
DEFAULT_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.blocked.json"
REQUIRED_SECTIONS = {
    "secure_session_cookie",
    "csrf_same_site_enforcement",
    "secret_exposure_redaction",
    "admin_surface_privacy",
    "provider_key_containment",
    "stripe_live_test_separation",
    "rate_limit_spend_cap",
    "csp_headers",
    "rbac_tenant_isolation",
    "audit_refs",
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
)
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|"
    r"t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)


class ProductionSecurityProofValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionSecurityProofValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionSecurityProofValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionSecurityProofValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in {"secret", "secret_key", "api_key", "authorization", "cookie", "raw_payload"}, f"{path}.{key} exposes secret/raw field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def validate_proof(data: dict[str, Any]) -> None:
    assert_no_secret(data, "proof")
    require(data.get("schema_version") == "stage1.production_security_proof.v1", "proof schema_version mismatch")
    require(data.get("environment") == "production", "proof environment mismatch")
    require(data.get("kind") == "production_security_launch_proof", "proof kind mismatch")
    require(data.get("status") == "pass", "proof status must pass")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"proof {field} must be false")
    require(REQUIRED_SECTIONS <= set(data), "proof missing required sections")
    for section_name in sorted(REQUIRED_SECTIONS):
        section = data.get(section_name)
        require(isinstance(section, dict), f"{section_name} must be object")
        require(section.get("status") == "pass", f"{section_name}.status must pass")
        refs = section.get("refs") if section_name == "audit_refs" else section.get("evidence_refs")
        require(isinstance(refs, list) and refs, f"{section_name} refs/evidence_refs must be non-empty")
    require(data["secure_session_cookie"].get("http_only") is True, "http_only must be true")
    require(data["secure_session_cookie"].get("secure") is True, "secure must be true")
    require(str(data["secure_session_cookie"].get("same_site", "")).lower() in {"lax", "strict"}, "same_site mismatch")
    require(data["csrf_same_site_enforcement"].get("cross_site_mutations_denied") is True, "CSRF proof mismatch")
    require(data["secret_exposure_redaction"].get("raw_secret_exposure_count") == 0, "secret exposure count mismatch")
    require(data["admin_surface_privacy"].get("raw_private_payload_visible") is False, "admin surface privacy mismatch")
    require(data["provider_key_containment"].get("frontend_secret_exposure_count") == 0, "provider key containment mismatch")
    require(data["stripe_live_test_separation"].get("live_mode_isolated") is True, "Stripe live/test separation mismatch")
    require(data["rate_limit_spend_cap"].get("kill_switch_ready") is True, "kill switch readiness mismatch")
    require(data["csp_headers"].get("csp_present") is True, "CSP proof mismatch")
    require(data["rbac_tenant_isolation"].get("cross_tenant_denials") is True, "RBAC tenant isolation mismatch")


def validate_blocked(data: dict[str, Any]) -> None:
    assert_no_secret(data, "diagnostic")
    require(data.get("schema_version") == "stage1.production_security_proof.blocked.v1", "diagnostic schema_version mismatch")
    require(data.get("environment") == "production", "diagnostic environment mismatch")
    require(data.get("kind") == "production_security_launch_proof", "diagnostic kind mismatch")
    require(data.get("status") == "blocked", "diagnostic status must be blocked")
    require(data.get("canonical_source_written") is False, "diagnostic must not write canonical source")
    blockers = data.get("blocked_checks")
    require(isinstance(blockers, list) and blockers, "diagnostic blocked_checks must be non-empty")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"diagnostic {field} must be false")


def validate_contract() -> None:
    require(SCRIPT.exists() and SCRIPT.stat().st_mode & 0o111, "stage1_production_security_proof.py must be executable")
    text = SCRIPT.read_text(encoding="utf-8")
    for token in (
        "stage1.production_security_proof.v1",
        "stage1.production_security_proof.blocked.v1",
        "secure_session_cookie_ref",
        "collect_blockers",
        "collect_ref_blockers",
        "require_zero",
        "raw_secret_exposure_count",
        "frontend_secret_exposure_count",
        "operator_next_command_after_pass",
        "stage1_production_source_probe.py --security",
    ):
        require(token in text, f"helper missing {token}")
    source_probe = SOURCE_PROBE.read_text(encoding="utf-8")
    require("--security-proof" in source_probe and "build_security_source" in source_probe, "source probe must accept security proof")


def run_blocked_selftest() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        diagnostic = Path(tmp) / "blocked.json"
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--diagnostic",
                str(diagnostic),
                "--release-sha",
                "0123456789abcdef0123456789abcdef01234567",
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        require(result.returncode == 2, f"blocked selftest must exit 2, got {result.returncode}: {result.stderr or result.stdout}")
        data = load_json(diagnostic)
        validate_blocked(data)
        blockers = data.get("blocked_checks")
        require(isinstance(blockers, list), "blocked selftest blocked_checks must be list")
        for expected in (
            "secure_session_cookie_ref_missing",
            "csrf_same_site_ref_missing",
            "csp_headers_ref_missing",
            "audit_ref_missing",
        ):
            require(expected in blockers, f"blocked selftest missing aggregate blocker {expected}")
        require(len(blockers) >= 10, "blocked selftest must aggregate all missing security proof inputs")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--proof", type=Path, default=DEFAULT_PROOF)
    parser.add_argument("--diagnostic", type=Path, default=DEFAULT_DIAGNOSTIC)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract()
        run_blocked_selftest()
        if args.contract_only:
            print("stage1 production security proof helper contract passed")
            return 0
        if args.proof.exists():
            validate_proof(load_json(args.proof))
        elif args.diagnostic.exists():
            validate_blocked(load_json(args.diagnostic))
        else:
            raise ProductionSecurityProofValidationError("missing proof or blocked diagnostic")
    except ProductionSecurityProofValidationError as exc:
        raise SystemExit(f"stage1 production security proof helper validation failed: {exc}") from exc
    print("stage1 production security proof helper validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
