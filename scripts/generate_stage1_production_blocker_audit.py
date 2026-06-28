#!/usr/bin/env python3
"""Generate a non-clearing audit of the remaining Stage 1 production blockers.

This artifact exists to stop the final launch work from looping on vague
"what is missing?" status checks. It classifies only safe local configuration
states and validator outcomes; it never persists raw env values, cookies,
authorization headers, database URLs, Stripe payloads, provider payloads, or
secrets.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV = ROOT / ".env"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-blocker-audit.json"
DEFAULT_CLOSURE_QUEUE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-evidence-closure-queue.preflight.json"
DEFAULT_INPUT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-input-packet.json"
DEFAULT_DNS_READINESS = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_PROOF_BUNDLE = ROOT / "ops" / "evidence" / "non_clearing" / "production-proof-bundle.json"

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

SOURCE_PROBES = [
    {
        "probe_id": "production_paid_billing_lifecycle",
        "source_path": "ops/evidence/production/billing-paid-lifecycle-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.billing.json",
        "strict_validator": "scripts/validate_stage1_production_billing_evidence.py",
        "missing_input": "SANITIZED_LIVE_BILLING_PROOF_JSON",
        "operator_action": "provide sanitized Stripe live billing proof with livemode=true",
    },
    {
        "probe_id": "production_security_launch_checks",
        "source_path": "ops/evidence/production/production-security-launch-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.security.json",
        "strict_validator": "scripts/validate_stage1_production_security_launch_evidence.py",
        "missing_input": "SANITIZED_PRODUCTION_SECURITY_PROOF_JSON",
        "operator_action": "run production security probes and provide sanitized proof JSON",
    },
    {
        "probe_id": "production_legal_support_policy",
        "source_path": "ops/evidence/production/production-legal-support-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.legal-support.json",
        "strict_validator": "scripts/validate_stage1_production_legal_support_evidence.py",
        "missing_input": "PRODUCTION_WEB_URL",
        "operator_action": "fix production zenari.ai DNS/HTTPS and rerun legal/support source probe",
    },
    {
        "probe_id": "production_governance_release",
        "source_path": "ops/evidence/production/production-governance-release-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.governance.json",
        "strict_validator": "scripts/validate_stage1_production_governance_release_evidence.py",
        "missing_input": "SANITIZED_PRODUCTION_GOVERNANCE_PROOF_JSON",
        "operator_action": "provide sanitized production governance runtime/audit proof JSON",
    },
]

RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"X-Amz-Signature|GoogleAccessId)"
)
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
    "database_url",
    "postgres_url",
    "download_url",
    "signed_url",
}


class ProductionBlockerAuditError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        raise ProductionBlockerAuditError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProductionBlockerAuditError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionBlockerAuditError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionBlockerAuditError(f"{path} contains raw secret-looking material")


def sanitize_text(value: str, limit: int = 700) -> str:
    folded = " ".join(line.strip() for line in value.splitlines() if line.strip())
    folded = RAW_SECRET_RE.sub("[redacted]", folded)
    return folded[:limit]


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = value.strip().strip("'\"")
        values[key] = value
    return values


def env_value(values: dict[str, str], key: str) -> str:
    if key in os.environ:
        return os.environ[key]
    return values.get(key, "")


def classify_secret_shape(value: str, *, publishable: bool = False) -> str:
    if not value:
        return "missing"
    if publishable:
        if value.startswith("pk_live_"):
            return "live_publishable"
        if value.startswith("pk_test_"):
            return "test_publishable"
        return "set_nonstandard_publishable"
    if value.startswith("sk_live_"):
        return "live_secret"
    if value.startswith("rk_live_"):
        return "live_restricted"
    if value.startswith("sk_test_"):
        return "test_secret"
    if value.startswith("rk_test_"):
        return "test_restricted"
    if value.startswith("whsec_"):
        return "webhook_secret_set"
    if re.fullmatch(r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}", value):
        return "zai_key_shape"
    if value.startswith("sk-"):
        return "openai_secret_shape"
    return "set_nonstandard"


def classify_url(value: str) -> str:
    if not value:
        return "missing"
    lowered = value.lower()
    if lowered.startswith("https://"):
        if "localhost" in lowered or "127.0.0.1" in lowered:
            return "https_localhost"
        return "https_configured"
    if lowered.startswith("http://"):
        if "localhost" in lowered or "127.0.0.1" in lowered:
            return "http_localhost"
        return "http_configured"
    return "set_non_url"


def local_env_classification(env_path: Path) -> dict[str, Any]:
    env = read_env_file(env_path)
    stripe_mode = env_value(env, "STRIPE_MODE").strip().lower()
    if stripe_mode not in {"", "test", "live"}:
        stripe_mode = "set_nonstandard"
    return {
        "env_file": display_path(env_path),
        "env_file_present": env_path.exists(),
        "stripe": {
            "mode": stripe_mode or "missing",
            "api_key_class": classify_secret_shape(env_value(env, "STRIPE_API_KEY")),
            "secret_key_class": classify_secret_shape(env_value(env, "STRIPE_SECRET_KEY")),
            "publishable_key_class": classify_secret_shape(env_value(env, "STRIPE_PUBLISHABLE_KEY"), publishable=True),
            "webhook_secret_class": classify_secret_shape(env_value(env, "STRIPE_WEBHOOK_SECRET")),
            "live_secret_configured": classify_secret_shape(env_value(env, "STRIPE_SECRET_KEY")) in {"live_secret", "live_restricted"},
        },
        "llm": {
            "provider": "configured" if env_value(env, "LLM_PROVIDER") else "missing",
            "openai_base_url": classify_url(env_value(env, "LLM_OPENAI_BASE_URL")),
            "api_key_class": classify_secret_shape(env_value(env, "LLM_OPENAI_API_KEY")),
            "model": "configured" if env_value(env, "LLM_OPENAI_MODEL") else "missing",
        },
        "object_storage": {
            "provider": "configured" if env_value(env, "OBJECT_STORAGE_PROVIDER") else "missing",
            "bucket_is_zenari": env_value(env, "OBJECT_STORAGE_BUCKET") == "zenari",
            "endpoint": classify_url(env_value(env, "OBJECT_STORAGE_ENDPOINT")),
            "access_key_configured": bool(env_value(env, "OBJECT_STORAGE_ACCESS_KEY")),
            "secret_key_configured": bool(env_value(env, "OBJECT_STORAGE_SECRET_KEY")),
        },
        "staging": {
            "api_url": classify_url(env_value(env, "STAGING_API_URL")),
            "web_url": classify_url(env_value(env, "STAGING_WEB_URL")),
            "admin_url": classify_url(env_value(env, "STAGING_ADMIN_URL")),
            "database_configured": env_value(env, "STAGING_DATABASE_URL") != "",
            "quota_replay_api_url": classify_url(env_value(env, "STAGING_QUOTA_REPLAY_API_URL")),
        },
    }


def run_validator(command_ref: str) -> dict[str, Any]:
    result = subprocess.run(
        ["python3", command_ref],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=180,
    )
    detail = sanitize_text((result.stderr or result.stdout).strip())
    return {
        "command": f"python3 {command_ref}",
        "exit_code": result.returncode,
        "status": "pass" if result.returncode == 0 else "blocked",
        "summary": detail or ("passed" if result.returncode == 0 else "no diagnostic output"),
    }


def diagnostic_summary(path_ref: str) -> dict[str, Any]:
    path = ROOT / path_ref
    data = load_json(path)
    blockers = data.get("blockers") if isinstance(data.get("blockers"), list) else []
    blocked_checks = data.get("blocked_checks") if isinstance(data.get("blocked_checks"), list) else []
    first = data.get("first_blocker") or (blockers[0] if blockers else None) or (blocked_checks[0] if blocked_checks else None)
    return {
        "path": path_ref,
        "exists": path.exists(),
        "status": data.get("status", "missing") if data else "missing",
        "first_blocker": sanitize_text(str(first or "not reported")),
    }


def input_packet_rows(packet: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = packet.get("source_inputs")
    if not isinstance(rows, list):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("probe_id"), str):
            result[row["probe_id"]] = row
    return result


def closure_summary(path: Path) -> dict[str, Any]:
    data = load_json(path)
    summary = data.get("queue_summary") if isinstance(data.get("queue_summary"), dict) else {}
    return {
        "path": display_path(path),
        "status": data.get("status", "missing") if data else "missing",
        "release_gate_decision": data.get("release_gate_decision", "no_go") if data else "no_go",
        "completed": summary.get("completed"),
        "total": summary.get("total"),
        "open": summary.get("open"),
        "completion_percent": summary.get("completion_percent"),
        "open_gates": summary.get("open_gates", []),
    }


def dns_summary(path: Path) -> dict[str, Any]:
    data = load_json(path)
    blocked_checks = data.get("blocked_checks") if isinstance(data.get("blocked_checks"), list) else []
    doh = data.get("dns_over_https_probe") if isinstance(data.get("dns_over_https_probe"), dict) else {}
    public_addresses = data.get("public_production_addresses_observed")
    return {
        "path": display_path(path),
        "status": data.get("status", "missing") if data else "missing",
        "release_gate_decision": data.get("release_gate_decision", "no_go") if data else "no_go",
        "production_web_url": "https://zenari.ai",
        "first_blocker": sanitize_text(str(blocked_checks[0] if blocked_checks else "not reported")),
        "system_resolver_status": (
            data.get("system_resolver", {}).get("production", {}).get("status")
            if isinstance(data.get("system_resolver"), dict)
            else "missing"
        ),
        "public_dns_a_status": (
            data.get("authoritative_public_dns_probe", {}).get("production_a", {}).get("status")
            if isinstance(data.get("authoritative_public_dns_probe"), dict)
            else "missing"
        ),
        "public_dns_aaaa_status": (
            data.get("authoritative_public_dns_probe", {}).get("production_aaaa", {}).get("status")
            if isinstance(data.get("authoritative_public_dns_probe"), dict)
            else "missing"
        ),
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
    }


def proof_bundle_summary(path: Path) -> dict[str, Any]:
    data = load_json(path)
    coverage = data.get("input_variable_coverage") if isinstance(data.get("input_variable_coverage"), dict) else {}
    groups = coverage.get("groups") if isinstance(coverage.get("groups"), dict) else {}
    proofs = data.get("proofs") if isinstance(data.get("proofs"), dict) else {}
    first_missing = coverage.get("first_missing_or_invalid_inputs")
    if not isinstance(first_missing, list):
        first_missing = []
    return {
        "path": display_path(path),
        "exists": path.exists(),
        "status": data.get("status", "missing") if data else "missing",
        "release_gate_decision": data.get("release_gate_decision", "no_go") if data else "no_go",
        "canonical_sources_requested": data.get("canonical_sources_requested") is True if data else False,
        "proof_statuses": {
            "billing": proofs.get("billing", {}).get("status") if isinstance(proofs.get("billing"), dict) else "missing",
            "security": proofs.get("security", {}).get("status") if isinstance(proofs.get("security"), dict) else "missing",
            "governance": proofs.get("governance", {}).get("status") if isinstance(proofs.get("governance"), dict) else "missing",
        },
        "input_variable_coverage": {
            "schema_version": coverage.get("schema_version", "missing"),
            "value_redaction": coverage.get("value_redaction", "missing"),
            "required_total": coverage.get("required_total", 0),
            "required_configured": coverage.get("required_configured", 0),
            "required_missing": coverage.get("required_missing", 0),
            "required_invalid": coverage.get("required_invalid", 0),
            "blocking_input_count": coverage.get("blocking_input_count", 0),
            "required_completion_percent": coverage.get("required_completion_percent", 0),
            "first_missing_or_invalid_inputs": [sanitize_text(str(item), 160) for item in first_missing[:12]],
            "groups": {
                name: {
                    "required_total": value.get("required_total", 0),
                    "required_configured": value.get("required_configured", 0),
                    "required_missing": value.get("required_missing", 0),
                    "required_invalid": value.get("required_invalid", 0),
                }
                for name, value in groups.items()
                if isinstance(value, dict)
            },
        },
    }


def source_audit(packet: dict[str, Any]) -> list[dict[str, Any]]:
    packet_rows = input_packet_rows(packet)
    rows: list[dict[str, Any]] = []
    for probe in SOURCE_PROBES:
        source_path = ROOT / probe["source_path"]
        packet_row = packet_rows.get(probe["probe_id"], {})
        strict = run_validator(probe["strict_validator"])
        if source_path.exists() and strict["status"] == "pass":
            source_status = "source_present_strict_pass"
        elif source_path.exists():
            source_status = "source_present_strict_blocked"
        else:
            source_status = "source_missing"
        first_blocker = (
            packet_row.get("first_blocker")
            or packet_row.get("current_blocker")
            or diagnostic_summary(probe["diagnostic_path"]).get("first_blocker")
            or strict.get("summary")
        )
        rows.append(
            {
                "probe_id": probe["probe_id"],
                "status": source_status,
                "source_path": probe["source_path"],
                "source_probe_exists": source_path.exists(),
                "missing_input": probe["missing_input"],
                "operator_action": probe["operator_action"],
                "first_blocker": sanitize_text(str(first_blocker)),
                "diagnostic": diagnostic_summary(probe["diagnostic_path"]),
                "strict_validation": strict,
            }
        )
    return rows


def build_audit(args: argparse.Namespace) -> dict[str, Any]:
    packet = load_json(args.input_packet)
    sources = source_audit(packet)
    open_sources = [row["probe_id"] for row in sources if row["strict_validation"]["status"] != "pass"]
    data: dict[str, Any] = {
        "schema_version": "stage1.production_blocker_audit.v1",
        "environment": "production",
        "kind": "stage1_production_blocker_audit",
        "status": "blocked" if open_sources else "ready",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "non_clearing_audit": True,
        "canonical_pass_path": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "source_refs": {
            "closure_queue": display_path(args.closure_queue),
            "input_packet": display_path(args.input_packet),
            "production_dns_readiness": display_path(args.dns_readiness),
            "production_proof_bundle": display_path(args.proof_bundle),
        },
        "closure_summary": closure_summary(args.closure_queue),
        "local_env_classification": local_env_classification(args.env_file),
        "production_dns_readiness": dns_summary(args.dns_readiness),
        "production_proof_bundle": proof_bundle_summary(args.proof_bundle),
        "production_source_audit": sources,
        "open_source_probe_ids": open_sources,
        "final_blocker_count": len(open_sources),
        "operator_summary": {
            "additional_sandbox_or_llm_inputs_needed": False,
            "stripe_sandbox_is_not_current_blocker": True,
            "staging_is_not_current_blocker": True,
            "production_live_source_inputs_needed": open_sources,
        },
        "gate_impact": {
            "can_clear_stage1_production_launch_gate": False,
            "can_close_do_not_launch": False,
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "production_blocker_audit")
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--closure-queue", type=Path, default=DEFAULT_CLOSURE_QUEUE)
    parser.add_argument("--input-packet", type=Path, default=DEFAULT_INPUT_PACKET)
    parser.add_argument("--dns-readiness", type=Path, default=DEFAULT_DNS_READINESS)
    parser.add_argument("--proof-bundle", type=Path, default=DEFAULT_PROOF_BUNDLE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if [item["probe_id"] for item in SOURCE_PROBES] != [
            "production_paid_billing_lifecycle",
            "production_security_launch_checks",
            "production_legal_support_policy",
            "production_governance_release",
        ]:
            raise SystemExit("production blocker audit probe contract mismatch")
        print("stage1 production blocker audit contract passed")
        return 0
    data = build_audit(args)
    write_json(args.output, data)
    print(f"wrote Stage 1 production blocker audit to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
