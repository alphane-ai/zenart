#!/usr/bin/env python3
"""Generate Stage 1 production provider/claims split evidence.

This generator is deliberately conservative. It writes canonical pass evidence
only from a safe production source probe that proves either real-provider mode
or explicit invite/comp-only mode, public claims alignment, provider monitoring,
cost/routing safety, and audit references. Without that source it writes
blocked diagnostics and exits 2, so check-level or local-devport evidence cannot
accidentally clear the production provider claims gate.
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
DEFAULT_PROVIDER = ROOT / "ops" / "evidence" / "production" / "provider-mode.json"
DEFAULT_CLAIMS = ROOT / "ops" / "evidence" / "production" / "public-paid-real-generation-claims.json"
DEFAULT_SOURCE = ROOT / "ops" / "evidence" / "production" / "provider-claims-source.json"
STRICT_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_provider_claims_evidence.py"
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed"}
LAUNCH_MODES = {"real_provider", "invite_comp_only"}
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
    "dev_mock_provider_public_claims_unresolved",
    "real_provider_or_comp_only_mode_missing",
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
PROVIDER_SECTIONS = ("provider_mode", "provider_contract", "monitoring_cost", "routing_safety")
CLAIM_SECTIONS = ("public_claim_probes", "paid_real_generation_claims", "dev_provider_claim_denial")


class ProductionProviderClaimsGenerationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionProviderClaimsGenerationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ProductionProviderClaimsGenerationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def source_claims(source: dict[str, Any]) -> dict[str, Any]:
    claims = source.get("public_claims")
    if not isinstance(claims, dict):
        claims = source.get("claims")
    require(isinstance(claims, dict), "source public_claims/claims must be an object")
    return claims


def require_ref_list(value: Any, path: str) -> list[str]:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    refs: list[str] = []
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be a non-empty string")
        refs.append(item.strip())
    return refs


def source_list(source: dict[str, Any], claims: dict[str, Any], source_keys: tuple[str, ...], claims_keys: tuple[str, ...], path: str) -> list[str]:
    for key in source_keys:
        if key in source:
            return require_ref_list(source[key], f"source.{key}")
    for key in claims_keys:
        if key in claims:
            return require_ref_list(claims[key], f"source.public_claims.{key}")
    raise ProductionProviderClaimsGenerationError(f"{path} must be a non-empty list")


def source_blockers(source_path: Path, data: dict[str, Any], release_sha: str) -> list[str]:
    blockers: list[str] = []
    try:
        assert_no_secret(data, "source")
    except ProductionProviderClaimsGenerationError as exc:
        blockers.append(str(exc))
    blockers.extend(blocked_gate_signal_blockers(data, "source"))
    markers = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
    if markers:
        blockers.append(f"{display_path(source_path)} contains blocked/deferred marker(s): {markers}")
    if data.get("schema_version") != "stage1.production_provider_claims_source.v1":
        blockers.append(f"{display_path(source_path)} schema_version is not stage1.production_provider_claims_source.v1")
    if data.get("environment") != "production":
        blockers.append(f"{display_path(source_path)} environment is not production")
    if not is_pass_status(data.get("status")):
        blockers.append(f"{display_path(source_path)} status is not pass/passed")
    if data.get("release_gate_check_id") != "production_provider_or_comp_only_mode":
        blockers.append(f"{display_path(source_path)} release gate check mismatch")
    if data.get("release_sha") and str(data.get("release_sha")).strip().lower() != release_sha:
        blockers.append(f"{display_path(source_path)} release_sha does not match requested release")
    launch_mode = data.get("launch_mode")
    if launch_mode not in LAUNCH_MODES:
        blockers.append(f"{display_path(source_path)} launch_mode must be real_provider or invite_comp_only")
    for section in PROVIDER_SECTIONS:
        if not isinstance(data.get(section), dict):
            blockers.append(f"{display_path(source_path)} {section} object is missing")
    claims = data.get("public_claims") if isinstance(data.get("public_claims"), dict) else data.get("claims")
    if not isinstance(claims, dict):
        blockers.append(f"{display_path(source_path)} public_claims object is missing")
    else:
        if not isinstance(claims.get("public_claim_probes"), list) or not claims.get("public_claim_probes"):
            blockers.append(f"{display_path(source_path)} public_claims.public_claim_probes list is missing")
        for section in CLAIM_SECTIONS[1:]:
            if not isinstance(claims.get(section), dict):
                blockers.append(f"{display_path(source_path)} public_claims.{section} object is missing")
        try:
            source_list(
                data,
                claims,
                ("provider_runtime_request_ids", "runtime_request_ids"),
                (),
                "source.provider_runtime_request_ids",
            )
        except ProductionProviderClaimsGenerationError as exc:
            blockers.append(str(exc))
        try:
            source_list(data, claims, ("provider_audit_refs", "audit_refs"), (), "source.provider_audit_refs")
        except ProductionProviderClaimsGenerationError as exc:
            blockers.append(str(exc))
        try:
            source_list(data, claims, ("claims_runtime_request_ids",), ("runtime_request_ids",), "source.claims_runtime_request_ids")
        except ProductionProviderClaimsGenerationError as exc:
            blockers.append(str(exc))
        try:
            source_list(data, claims, ("claims_audit_refs",), ("audit_refs",), "source.claims_audit_refs")
        except ProductionProviderClaimsGenerationError as exc:
            blockers.append(str(exc))
    return blockers


def common_base(schema_version: str, kind: str, release_sha: str, generated_at: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": schema_version,
        "environment": "production",
        "kind": kind,
        "status": "pass",
        "release_gate_check_id": "production_provider_or_comp_only_mode",
        "release_sha": release_sha,
        "canonical_pass_path": True,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "check_level_only": False,
        "generated_at": generated_at,
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def build_pass(data: dict[str, Any], release_sha: str, source_path: Path, generated_at: str) -> tuple[dict[str, Any], dict[str, Any]]:
    claims_source = source_claims(data)
    provider = common_base("stage1.production_provider_mode.v1", "production_provider_mode", release_sha, generated_at)
    provider["launch_mode"] = data["launch_mode"]
    for section in PROVIDER_SECTIONS:
        provider[section] = clone_json(data[section])
    provider["runtime_request_ids"] = source_list(
        data,
        claims_source,
        ("provider_runtime_request_ids", "runtime_request_ids"),
        (),
        "source.provider_runtime_request_ids",
    )
    provider["audit_refs"] = source_list(data, claims_source, ("provider_audit_refs", "audit_refs"), (), "source.provider_audit_refs")
    provider["source_probe"] = display_path(source_path)
    provider["gate_impact"] = {
        "release_gate_check_id": "production_provider_or_comp_only_mode",
        "can_clear_provider_mode_subitem": True,
    }

    claims = common_base(
        "stage1.production_public_paid_real_generation_claims.v1",
        "production_public_paid_real_generation_claims",
        release_sha,
        generated_at,
    )
    claims["launch_mode"] = data["launch_mode"]
    claims["public_claim_probes"] = clone_json(claims_source["public_claim_probes"])
    claims["paid_real_generation_claims"] = clone_json(claims_source["paid_real_generation_claims"])
    claims["dev_provider_claim_denial"] = clone_json(claims_source["dev_provider_claim_denial"])
    claims["runtime_request_ids"] = source_list(
        data,
        claims_source,
        ("claims_runtime_request_ids",),
        ("runtime_request_ids",),
        "source.claims_runtime_request_ids",
    )
    claims["audit_refs"] = source_list(data, claims_source, ("claims_audit_refs",), ("audit_refs",), "source.claims_audit_refs")
    claims["source_probe"] = display_path(source_path)
    claims["gate_impact"] = {
        "release_gate_check_id": "production_provider_or_comp_only_mode",
        "can_clear_public_paid_real_generation_claims_subitem": True,
    }
    return provider, claims


def blocked_report(blockers: list[str], release_sha: str, generated_at: str, kind: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": f"stage1.{kind}.blocked.v1",
        "environment": "production",
        "kind": kind,
        "status": "blocked",
        "release_gate_check_id": "production_provider_or_comp_only_mode",
        "release_sha": release_sha or None,
        "canonical_pass_path": False,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "check_level_only": False,
        "generated_at": generated_at,
        "semantic_tokens": [
            "provider",
            "monitoring",
            "cost",
            "comp-only",
            "paid",
            "real-generation",
            "claims",
            "hidden",
        ],
        "blocked_checks": blockers,
        "gate_impact": {
            "can_clear_provider_mode_subitem": False,
            "can_clear_public_paid_real_generation_claims_subitem": False,
            "can_clear_aggregate_production_gate": False,
            "preserved_release_gate_check_id": "production_provider_or_comp_only_mode",
            "remaining_blockers": blockers,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def run_strict_validator(provider_path: Path, claims_path: Path) -> tuple[bool, str]:
    result = subprocess.run(
        [
            sys.executable,
            str(STRICT_VALIDATOR),
            "--provider-evidence",
            str(provider_path),
            "--claims-evidence",
            str(claims_path),
        ],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    output = (result.stderr or result.stdout).strip()
    return result.returncode == 0, output


def build(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
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
        return (
            blocked_report(blockers, release_sha, generated_at, "production_provider_mode"),
            blocked_report(blockers, release_sha, generated_at, "production_public_paid_real_generation_claims"),
            blockers,
        )
    provider, claims = build_pass(source, release_sha, source_path, generated_at)
    return provider, claims, []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-sha", default="", help="full production release SHA; defaults to source.release_sha")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="safe production provider/claims source probe JSON")
    parser.add_argument("--provider-evidence", type=Path, default=DEFAULT_PROVIDER)
    parser.add_argument("--claims-evidence", type=Path, default=DEFAULT_CLAIMS)
    args = parser.parse_args()

    try:
        provider, claims, blockers = build(args)
        assert_no_secret(provider, "provider")
        assert_no_secret(claims, "claims")
        write_json(args.provider_evidence, provider)
        write_json(args.claims_evidence, claims)
        if not blockers:
            passed, output = run_strict_validator(args.provider_evidence, args.claims_evidence)
            if not passed:
                generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                blockers = [f"strict_validator_failed: {output}"]
                write_json(
                    args.provider_evidence,
                    blocked_report(blockers, provider.get("release_sha", ""), generated_at, "production_provider_mode"),
                )
                write_json(
                    args.claims_evidence,
                    blocked_report(
                        blockers,
                        claims.get("release_sha", ""),
                        generated_at,
                        "production_public_paid_real_generation_claims",
                    ),
                )
    except ProductionProviderClaimsGenerationError as exc:
        print(f"stage1 production provider claims evidence generation failed: {exc}", file=sys.stderr)
        return 1

    if blockers:
        print(f"stage1 production provider claims split evidence generated: blocked ({args.provider_evidence}, {args.claims_evidence})")
        return 2
    print(f"stage1 production provider claims split evidence generated: pass ({args.provider_evidence}, {args.claims_evidence})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
