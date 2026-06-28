#!/usr/bin/env python3
"""Generate Stage 1 production security launch evidence.

The generator is conservative: canonical pass evidence is written only from a
safe production source probe that proves the exact security-launch sections
required by the strict validator. Without that source it writes blocked
diagnostics and exits 2, so preserved-blocker or check-level evidence cannot
clear the production security launch gate.
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
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "20260527T1700Z-security-launch-checks.json"
DEFAULT_SOURCE = ROOT / "ops" / "evidence" / "production" / "production-security-launch-source.json"
STRICT_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_security_launch_evidence.py"
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed"}
REQUIRED_SECTIONS = (
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
    "download_url",
    "signed_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)
BLOCKED_MARKERS = {
    "blocked",
    "blocked_by_other_production_runtime_items",
    "blocked_by_upstream_gates",
    "failed",
    "fail",
    "planned",
    "dry_run",
    "no_go",
    "no-go",
    "missing",
    "deferred",
    "pass_with_blockers_preserved",
    "security_privacy_legal_incomplete",
    "secret_exposure_runtime_not_verified",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
}
LOCAL_DEBUG_TRUE_FIELDS = {"local_devport_debug", "allow_local_devport_evidence"}
CANONICAL_PATH_FALSE_FIELDS = {"canonical_pass_path", "canonical_pass_paths"}
GATE_EMPTY_FIELDS = {
    "blocked_checks",
    "blocked_by_checks",
    "blockers",
    "do_not_launch_conditions",
    "active_do_not_launch_conditions",
    "remaining_blockers",
}
GATE_CLEAR_FIELDS = {
    "do_not_launch_condition_id",
    "do_not_launch_condition_ids",
    "preserved_do_not_launch_condition_id",
    "preserved_release_gate_check_id",
    "preserved_do_not_launch_condition_ids",
}


class ProductionSecurityLaunchGenerationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionSecurityLaunchGenerationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ProductionSecurityLaunchGenerationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def clone_json(value: Any) -> Any:
    return json.loads(json.dumps(value, sort_keys=True))


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
            require(normalized not in SECRET_FIELD_NAMES, f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def truthy_gate_value(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"})


def falsey_gate_value(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.strip().lower() in {"false", "0", "no"})


def blocked_gate_signal_blockers(value: Any, path: str) -> list[str]:
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
                blockers.append(f"{child_path} is false")
            if normalized in GATE_EMPTY_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not empty")
            if normalized in GATE_CLEAR_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not cleared")
            blockers.extend(blocked_gate_signal_blockers(child, child_path))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            blockers.extend(blocked_gate_signal_blockers(child, f"{path}[{idx}]"))
    return blockers


def is_pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def source_blockers(source_path: Path, data: dict[str, Any], release_sha: str) -> list[str]:
    blockers: list[str] = []
    try:
        assert_no_secret(data, "source")
    except ProductionSecurityLaunchGenerationError as exc:
        blockers.append(str(exc))
    blockers.extend(blocked_gate_signal_blockers(data, "source"))
    markers = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
    if markers:
        blockers.append(f"{display_path(source_path)} contains blocked/deferred marker(s): {markers}")
    if data.get("schema_version") != "stage1.production_security_launch_source.v1":
        blockers.append(f"{display_path(source_path)} schema_version is not stage1.production_security_launch_source.v1")
    if data.get("environment") != "production":
        blockers.append(f"{display_path(source_path)} environment is not production")
    if not is_pass_status(data.get("status")):
        blockers.append(f"{display_path(source_path)} status is not pass/passed")
    if data.get("release_gate_check_id") != "production_security_launch_checks":
        blockers.append(f"{display_path(source_path)} release gate check mismatch")
    if data.get("release_sha") and str(data.get("release_sha")).strip().lower() != release_sha:
        blockers.append(f"{display_path(source_path)} release_sha does not match requested release")
    for section in REQUIRED_SECTIONS:
        value = data.get(section)
        if not isinstance(value, dict):
            blockers.append(f"{display_path(source_path)} {section} object is missing")
    return blockers


def build_pass(data: dict[str, Any], release_sha: str, source_path: Path, generated_at: str) -> dict[str, Any]:
    report: dict[str, Any] = {
        "schema_version": "stage1.production_security_launch.v1",
        "environment": "production",
        "kind": "production_security_launch_checks",
        "status": "pass",
        "release_gate_check_id": "production_security_launch_checks",
        "release_sha": release_sha,
        "canonical_pass_path": True,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "check_level_only": False,
        "generated_at": generated_at,
        "source_probe": display_path(source_path),
    }
    for section in REQUIRED_SECTIONS:
        report[section] = clone_json(data[section])
    report["gate_impact"] = {
        "release_gate_check_id": "production_security_launch_checks",
        "can_clear_security_launch_check": True,
    }
    report.update(SAFE_FALSE_FIELDS)
    return report


def blocked_report(blockers: list[str], release_sha: str, generated_at: str) -> dict[str, Any]:
    report: dict[str, Any] = {
        "schema_version": "stage1.production_security_launch.blocked.v1",
        "environment": "production",
        "kind": "production_security_launch_checks",
        "status": "blocked",
        "release_gate_check_id": "production_security_launch_checks",
        "release_sha": release_sha or None,
        "canonical_pass_path": False,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "check_level_only": False,
        "generated_at": generated_at,
        "blocked_checks": blockers,
        "gate_impact": {
            "can_clear_security_launch_check": False,
            "preserved_release_gate_check_id": "production_security_launch_checks",
            "remaining_blockers": blockers,
        },
    }
    report.update(SAFE_FALSE_FIELDS)
    return report


def run_strict_validator(evidence_path: Path) -> tuple[bool, str]:
    result = subprocess.run(
        [sys.executable, str(STRICT_VALIDATOR), "--evidence", str(evidence_path)],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    output = (result.stderr or result.stdout).strip()
    return result.returncode == 0, output


def build(args: argparse.Namespace) -> tuple[dict[str, Any], list[str]]:
    source_path = args.source
    release_sha = args.release_sha.strip().lower()
    blockers: list[str] = []
    if source_path.exists():
        source = load_json(source_path)
        if not release_sha:
            release_sha = str(source.get("release_sha", "")).strip().lower()
    else:
        source = {}
        blockers.append(f"source_probe_missing: {display_path(source_path)}")
    if RELEASE_SHA_RE.fullmatch(release_sha) is None:
        blockers.append("release_sha_missing_or_not_full_sha")
    if source:
        blockers.extend(source_blockers(source_path, source, release_sha))

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    if blockers:
        return blocked_report(blockers, release_sha, generated_at), blockers
    return build_pass(source, release_sha, source_path, generated_at), []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-sha", default="", help="full production release SHA; defaults to source.release_sha")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="safe production security launch source probe JSON")
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    args = parser.parse_args()

    try:
        report, blockers = build(args)
        assert_no_secret(report, "evidence")
        write_json(args.evidence, report)
        if not blockers:
            passed, output = run_strict_validator(args.evidence)
            if not passed:
                generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                blockers = [f"strict_validator_failed: {output}"]
                write_json(args.evidence, blocked_report(blockers, report.get("release_sha", ""), generated_at))
    except ProductionSecurityLaunchGenerationError as exc:
        print(f"stage1 production security launch evidence generation failed: {exc}", file=sys.stderr)
        return 1

    if blockers:
        print(f"stage1 production security launch evidence generated: blocked ({args.evidence})")
        return 2
    print(f"stage1 production security launch evidence generated: pass ({args.evidence})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
