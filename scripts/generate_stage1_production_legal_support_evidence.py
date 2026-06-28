#!/usr/bin/env python3
"""Generate Stage 1 production legal/support split evidence.

This generator writes canonical pass evidence only from a safe production
source probe that proves public legal pages, support contact/report problem,
support SLA, billing/refund/cancellation policy visibility, and paid-launch
policy alignment. Without that source it writes blocked diagnostics and exits
2, so check-level or local evidence cannot clear the production legal/support
gate.
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
DEFAULT_LEGAL = ROOT / "ops" / "evidence" / "production" / "public-legal-policy.json"
DEFAULT_SUPPORT = ROOT / "ops" / "evidence" / "production" / "public-support-billing-policy.json"
DEFAULT_SOURCE = ROOT / "ops" / "evidence" / "production" / "production-legal-support-source.json"
STRICT_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_legal_support_evidence.py"
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed"}
LEGAL_SECTIONS = ("page_probes", "coverage")
SUPPORT_SECTIONS = ("page_probes", "coverage", "paid_launch_policy_alignment")
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
    "public_legal_support_policy_not_deployed",
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


class ProductionLegalSupportGenerationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionLegalSupportGenerationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ProductionLegalSupportGenerationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def require_ref_list(value: Any, path: str) -> list[str]:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    refs: list[str] = []
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be a non-empty string")
        refs.append(item.strip())
    return refs


def source_blockers(source_path: Path, data: dict[str, Any], release_sha: str) -> list[str]:
    blockers: list[str] = []
    try:
        assert_no_secret(data, "source")
    except ProductionLegalSupportGenerationError as exc:
        blockers.append(str(exc))
    blockers.extend(blocked_gate_signal_blockers(data, "source"))
    markers = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
    if markers:
        blockers.append(f"{display_path(source_path)} contains blocked/deferred marker(s): {markers}")
    if data.get("schema_version") != "stage1.production_legal_support_source.v1":
        blockers.append(f"{display_path(source_path)} schema_version is not stage1.production_legal_support_source.v1")
    if data.get("environment") != "production":
        blockers.append(f"{display_path(source_path)} environment is not production")
    if not is_pass_status(data.get("status")):
        blockers.append(f"{display_path(source_path)} status is not pass/passed")
    if data.get("release_gate_check_id") != "production_legal_support_policy":
        blockers.append(f"{display_path(source_path)} release gate check mismatch")
    if data.get("release_sha") and str(data.get("release_sha")).strip().lower() != release_sha:
        blockers.append(f"{display_path(source_path)} release_sha does not match requested release")
    legal = data.get("legal")
    support = data.get("support_billing")
    if not isinstance(legal, dict):
        blockers.append(f"{display_path(source_path)} legal object is missing")
    else:
        for section in LEGAL_SECTIONS:
            if not isinstance(legal.get(section), list):
                blockers.append(f"{display_path(source_path)} legal.{section} list is missing")
        try:
            require_ref_list(legal.get("runtime_request_ids"), "source.legal.runtime_request_ids")
            require_ref_list(legal.get("audit_refs"), "source.legal.audit_refs")
        except ProductionLegalSupportGenerationError as exc:
            blockers.append(str(exc))
    if not isinstance(support, dict):
        blockers.append(f"{display_path(source_path)} support_billing object is missing")
    else:
        for section in SUPPORT_SECTIONS:
            expected_type = dict if section == "paid_launch_policy_alignment" else list
            if not isinstance(support.get(section), expected_type):
                blockers.append(f"{display_path(source_path)} support_billing.{section} {expected_type.__name__} is missing")
        try:
            require_ref_list(support.get("runtime_request_ids"), "source.support_billing.runtime_request_ids")
            require_ref_list(support.get("audit_refs"), "source.support_billing.audit_refs")
        except ProductionLegalSupportGenerationError as exc:
            blockers.append(str(exc))
    return blockers


def common_base(schema_version: str, kind: str, release_sha: str, generated_at: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": schema_version,
        "environment": "production",
        "kind": kind,
        "status": "pass",
        "release_gate_check_id": "production_legal_support_policy",
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
    legal_source = data["legal"]
    support_source = data["support_billing"]
    legal = common_base("stage1.production_legal_policy.v1", "production_public_legal_policy", release_sha, generated_at)
    legal["runtime_request_ids"] = require_ref_list(legal_source.get("runtime_request_ids"), "source.legal.runtime_request_ids")
    legal["audit_refs"] = require_ref_list(legal_source.get("audit_refs"), "source.legal.audit_refs")
    legal["page_probes"] = clone_json(legal_source["page_probes"])
    legal["coverage"] = clone_json(legal_source["coverage"])
    legal["source_probe"] = display_path(source_path)
    legal["gate_impact"] = {
        "release_gate_check_id": "production_legal_support_policy",
        "can_clear_public_legal_subitem": True,
    }

    support = common_base(
        "stage1.production_support_billing_policy.v1",
        "production_public_support_billing_policy",
        release_sha,
        generated_at,
    )
    support["runtime_request_ids"] = require_ref_list(
        support_source.get("runtime_request_ids"),
        "source.support_billing.runtime_request_ids",
    )
    support["audit_refs"] = require_ref_list(support_source.get("audit_refs"), "source.support_billing.audit_refs")
    support["page_probes"] = clone_json(support_source["page_probes"])
    support["coverage"] = clone_json(support_source["coverage"])
    support["paid_launch_policy_alignment"] = clone_json(support_source["paid_launch_policy_alignment"])
    support["source_probe"] = display_path(source_path)
    support["gate_impact"] = {
        "release_gate_check_id": "production_legal_support_policy",
        "can_clear_support_billing_policy_subitem": True,
    }
    return legal, support


def blocked_report(blockers: list[str], release_sha: str, generated_at: str, kind: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": f"stage1.{kind}.blocked.v1",
        "environment": "production",
        "kind": kind,
        "status": "blocked",
        "release_gate_check_id": "production_legal_support_policy",
        "release_sha": release_sha or None,
        "canonical_pass_path": False,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "check_level_only": False,
        "generated_at": generated_at,
        "semantic_tokens": [
            "terms",
            "privacy",
            "acceptable use",
            "ai/content",
            "ip complaint",
            "support",
            "billing",
            "cancellation",
            "refund",
        ],
        "blocked_checks": blockers,
        "gate_impact": {
            "can_clear_public_legal_subitem": False,
            "can_clear_support_billing_policy_subitem": False,
            "can_clear_aggregate_production_gate": False,
            "preserved_release_gate_check_id": "production_legal_support_policy",
            "remaining_blockers": blockers,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def run_strict_validator(legal_path: Path, support_path: Path) -> tuple[bool, str]:
    result = subprocess.run(
        [
            sys.executable,
            str(STRICT_VALIDATOR),
            "--legal-evidence",
            str(legal_path),
            "--support-evidence",
            str(support_path),
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
            blocked_report(blockers, release_sha, generated_at, "production_public_legal_policy"),
            blocked_report(blockers, release_sha, generated_at, "production_public_support_billing_policy"),
            blockers,
        )
    legal, support = build_pass(source, release_sha, source_path, generated_at)
    return legal, support, []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-sha", default="", help="full production release SHA; defaults to source.release_sha")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="safe production legal/support source probe JSON")
    parser.add_argument("--legal-evidence", type=Path, default=DEFAULT_LEGAL)
    parser.add_argument("--support-evidence", type=Path, default=DEFAULT_SUPPORT)
    args = parser.parse_args()

    try:
        legal, support, blockers = build(args)
        assert_no_secret(legal, "legal")
        assert_no_secret(support, "support")
        write_json(args.legal_evidence, legal)
        write_json(args.support_evidence, support)
        if not blockers:
            passed, output = run_strict_validator(args.legal_evidence, args.support_evidence)
            if not passed:
                generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                blockers = [f"strict_validator_failed: {output}"]
                write_json(
                    args.legal_evidence,
                    blocked_report(blockers, legal.get("release_sha", ""), generated_at, "production_public_legal_policy"),
                )
                write_json(
                    args.support_evidence,
                    blocked_report(
                        blockers,
                        support.get("release_sha", ""),
                        generated_at,
                        "production_public_support_billing_policy",
                    ),
                )
    except ProductionLegalSupportGenerationError as exc:
        print(f"stage1 production legal/support evidence generation failed: {exc}", file=sys.stderr)
        return 1

    if blockers:
        print(f"stage1 production legal/support split evidence generated: blocked ({args.legal_evidence}, {args.support_evidence})")
        return 2
    print(f"stage1 production legal/support split evidence generated: pass ({args.legal_evidence}, {args.support_evidence})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
