#!/usr/bin/env python3
"""Probe or assemble safe Stage 1 production source evidence.

Default mode is non-clearing: it writes a blocked diagnostic so a local or
incomplete probe cannot clear production gates. Canonical source files are
written only when --write-canonical-source is passed and every required
production HTTPS/runtime proof is present.
"""

from __future__ import annotations

import argparse
import json
import re
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEGAL_SOURCE = ROOT / "ops" / "evidence" / "production" / "production-legal-support-source.json"
DEFAULT_SECURITY_SOURCE = ROOT / "ops" / "evidence" / "production" / "production-security-launch-source.json"
DEFAULT_BILLING_SOURCE = ROOT / "ops" / "evidence" / "production" / "billing-paid-lifecycle-source.json"
DEFAULT_GOVERNANCE_SOURCE = ROOT / "ops" / "evidence" / "production" / "production-governance-release-source.json"
DEFAULT_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.json"
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
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}

LEGAL_PAGES = {
    "terms": ("/legal/terms", ("Terms", "support contact", "AI content")),
    "privacy": ("/legal/privacy", ("Privacy", "data deletion", "support contact")),
    "acceptable_use": ("/legal/acceptable-use", ("Acceptable Use", "abuse", "support contact")),
    "ai_content_disclaimer": ("/support", ("AI content", "responsibility", "review")),
    "ip_complaint": ("/legal/ip-complaints", ("IP complaint", "copyright", "trademark", "takedown")),
}
SUPPORT_PAGES = {
    "support_contact": ("/support", ("support contact", "report problem", "privacy redaction", "escalation")),
    "report_problem": ("/report-problem", ("project", "task", "trace", "export", "quota")),
    "billing_policy": ("/legal/billing-policy", ("billing", "cancellation", "refund", "credit", "quota reset", "past_due")),
    "support_sla": ("/support", ("support SLA", "severity", "response time", "escalation")),
}
SECURITY_SECTIONS = (
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
BILLING_LIFECYCLE_SECTIONS = (
    "stripe_live_test_separation",
    "paid_checkout",
    "subscription_active",
    "subscription_past_due",
    "subscription_cancel",
    "team_seat_quantity_sync",
    "invoice_receipt_visibility",
    "audit_refs",
)
BILLING_REFUND_SECTIONS = (
    "refund_or_credit",
    "quota_reset",
    "webhook_idempotency",
    "failed_export_refund",
    "quota_projection",
    "audit_refs",
)
GOVERNANCE_COMPONENTS = {
    "activation": (
        "production_activation_review_audit",
        (
            "high_risk_rbac",
            "reviewer_rationale",
            "second_review",
            "audit_immutability",
            "activation_gates",
        ),
    ),
    "abuse": (
        "production_abuse_throttle_hold",
        ("account_hold", "rate_limit", "spend_cap_or_kill_switch", "rbac_audit"),
    ),
    "skill": (
        "production_skill_release_eval_canary",
        (
            "owner_risk",
            "eval_suite",
            "safety_refs",
            "canary_metrics",
            "rollback_target",
            "release_notes",
        ),
    ),
}


class SourceProbeError(Exception):
    pass


@dataclass(frozen=True)
class HttpProbe:
    url: str
    path: str
    status: int
    request_id: str
    headers: dict[str, str]
    text: str


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SourceProbeError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise SourceProbeError(f"{display_path(path)} must contain a JSON object")
    return data


def walk_values(value: Any) -> list[Any]:
    rows = [value]
    if isinstance(value, dict):
        for child in value.values():
            rows.extend(walk_values(child))
    elif isinstance(value, list):
        for child in value:
            rows.extend(walk_values(child))
    return rows


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise SourceProbeError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise SourceProbeError(f"{path} contains raw secret-looking material")


def require_release_sha(value: str) -> str:
    sha = value.strip().lower()
    if RELEASE_SHA_RE.fullmatch(sha) is None:
        raise SourceProbeError("release_sha_missing_or_not_full_sha")
    return sha


def ensure_production_https_base(raw_url: str, label: str) -> str:
    url = raw_url.strip().rstrip("/")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise SourceProbeError(f"{label} must be HTTPS")
    host = (parsed.hostname or "").lower()
    if not host:
        raise SourceProbeError(f"{label} host is missing")
    if host in LOCAL_HOSTS or host.endswith(".local") or host.endswith(".localhost"):
        raise SourceProbeError(f"{label} must not be localhost/local")
    return url


def ensure_host_resolves(base_url: str, label: str) -> None:
    parsed = urllib.parse.urlparse(base_url)
    host = parsed.hostname or ""
    try:
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise SourceProbeError(f"{label} host {host} did not resolve via system resolver: {exc}") from exc
    if not addresses:
        raise SourceProbeError(f"{label} host {host} did not resolve via system resolver")


def fetch_text(base_url: str, path: str, timeout: float) -> HttpProbe:
    url = f"{base_url}{path}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
            "User-Agent": "zenari-stage1-production-source-probe/1.0",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
            status = int(response.status)
            raw_headers = {key.lower(): value for key, value in response.headers.items()}
            body = response.read(512_000)
    except urllib.error.HTTPError as exc:
        raw_headers = {key.lower(): value for key, value in exc.headers.items()}
        body = exc.read(64_000)
        status = int(exc.code)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SourceProbeError(f"GET {url} failed: {exc}") from exc
    text = body.decode("utf-8", errors="replace")
    request_id = (
        raw_headers.get("x-request-id")
        or raw_headers.get("x-correlation-id")
        or raw_headers.get("cf-ray")
        or f"production-http-get:{urllib.parse.urlparse(url).path}"
    )
    return HttpProbe(url=url, path=path, status=status, request_id=request_id, headers=raw_headers, text=text)


def find_missing_tokens(text: str, tokens: tuple[str, ...]) -> list[str]:
    folded = text.lower()
    return [token for token in tokens if token.lower() not in folded]


def page_probe(page_id: str, path: str, tokens: tuple[str, ...], probe: HttpProbe) -> dict[str, Any]:
    return {
        "page_id": page_id,
        "path": path,
        "status": "pass",
        "http_status": probe.status,
        "visibility": "public",
        "external_user_visible": True,
        "admin_session_required": False,
        "required_tokens": list(tokens),
        "evidence_refs": [f"{probe.request_id}:{path}"],
    }


def coverage(area: str, *refs: str) -> dict[str, Any]:
    return {
        "area": area,
        "status": "pass",
        "evidence_refs": list(refs) or [f"production-source-probe:{area}"],
    }


def build_legal_support_source(args: argparse.Namespace) -> tuple[dict[str, Any] | None, list[str]]:
    base_url = ensure_production_https_base(args.production_web_url, "production web URL")
    release_sha = require_release_sha(args.release_sha)
    ensure_host_resolves(base_url, "production web URL")
    blockers: list[str] = []
    legal_probes: list[dict[str, Any]] = []
    support_probes: list[dict[str, Any]] = []
    legal_request_ids: list[str] = []
    support_request_ids: list[str] = []
    fetched_by_path: dict[str, HttpProbe] = {}

    page_specs: list[tuple[str, str, str, tuple[str, ...]]] = [
        *(("legal", page_id, path, tokens) for page_id, (path, tokens) in LEGAL_PAGES.items()),
        *(("support", page_id, path, tokens) for page_id, (path, tokens) in SUPPORT_PAGES.items()),
    ]
    for group, page_id, path, tokens in page_specs:
        if path not in fetched_by_path:
            try:
                fetched_by_path[path] = fetch_text(base_url, path, args.timeout)
            except SourceProbeError as exc:
                blockers.append(str(exc))
                continue
        probe = fetched_by_path[path]
        if probe.status != 200:
            blockers.append(f"{path} returned HTTP {probe.status}, expected 200")
            continue
        missing = find_missing_tokens(probe.text, tokens)
        if missing:
            blockers.append(f"{path} missing required tokens for {page_id}: {missing}")
            continue
        if RAW_SECRET_RE.search(probe.text):
            blockers.append(f"{path} contains secret-shaped material")
            continue
        if group == "legal":
            legal_request_ids.append(probe.request_id)
            legal_probes.append(page_probe(page_id, path, tokens, probe))
        else:
            support_request_ids.append(probe.request_id)
            support_probes.append(page_probe(page_id, path, tokens, probe))

    if blockers:
        return None, blockers

    legal_refs = [item["evidence_refs"][0] for item in legal_probes]
    support_refs = [item["evidence_refs"][0] for item in support_probes]
    data: dict[str, Any] = {
        "schema_version": "stage1.production_legal_support_source.v1",
        "environment": "production",
        "kind": "production_legal_support_source",
        "status": "pass",
        "release_gate_check_id": "production_legal_support_policy",
        "release_sha": release_sha,
        "generated_at": now(),
        "production_web_url": base_url,
        "legal": {
            "runtime_request_ids": sorted(set(legal_request_ids)),
            "audit_refs": [f"production-http-probe://legal-support/{release_sha}/legal"],
            "page_probes": legal_probes,
            "coverage": [
                coverage("public_legal_pages", *legal_refs),
                coverage("gate_clearance", *legal_refs),
            ],
        },
        "support_billing": {
            "runtime_request_ids": sorted(set(support_request_ids)),
            "audit_refs": [f"production-http-probe://legal-support/{release_sha}/support-billing"],
            "page_probes": support_probes,
            "coverage": [
                coverage("public_support_contact", *support_refs),
                coverage("billing_policy_visibility", *support_refs),
                coverage("support_sla", *support_refs),
                coverage("gate_clearance", *support_refs),
            ],
            "paid_launch_policy_alignment": {
                "billing_policy_visible": True,
                "refund_policy_visible": True,
                "cancellation_policy_visible": True,
                "support_sla_visible": True,
                "standalone_production_readiness_claim": False,
            },
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "legal_support_source")
    return data, []


def require_section(data: dict[str, Any], section: str, required: dict[str, Any]) -> dict[str, Any]:
    value = data.get(section)
    if not isinstance(value, dict):
        raise SourceProbeError(f"security proof missing {section} object")
    status = str(value.get("status", "")).strip().lower()
    if status not in {"pass", "passed"}:
        raise SourceProbeError(f"security proof {section}.status must pass")
    refs = value.get("evidence_refs")
    if section == "audit_refs":
        refs = value.get("refs", refs)
    if not isinstance(refs, list) or not refs or not all(isinstance(item, str) and item.strip() for item in refs):
        raise SourceProbeError(f"security proof {section} evidence refs must be non-empty")
    for key, expected in required.items():
        if value.get(key) != expected:
            raise SourceProbeError(f"security proof {section}.{key} must be {expected!r}")
    return dict(value)


def maybe_public_csp_probe(base_url: str | None, timeout: float) -> dict[str, Any] | None:
    if not base_url:
        return None
    probe = fetch_text(base_url, "/", timeout)
    csp = probe.headers.get("content-security-policy")
    if probe.status != 200 or not csp:
        return None
    if RAW_SECRET_RE.search(probe.text):
        raise SourceProbeError("/ contains secret-shaped material")
    return {
        "status": "pass",
        "evidence_refs": [f"{probe.request_id}:/"],
        "csp_present": True,
        "header_observed": "content-security-policy",
    }


def build_security_source(args: argparse.Namespace) -> tuple[dict[str, Any] | None, list[str]]:
    release_sha = require_release_sha(args.release_sha)
    blockers: list[str] = []
    if not args.security_proof:
        return None, ["security_proof_missing"]
    try:
        proof = read_json(args.security_proof)
        assert_no_secret(proof, "security_proof")
        web_url = ensure_production_https_base(args.production_web_url, "production web URL") if args.production_web_url else None
        public_csp = maybe_public_csp_probe(web_url, args.timeout) if web_url else None
        sections = {
            "secure_session_cookie": require_section(
                proof,
                "secure_session_cookie",
                {"http_only": True, "secure": True},
            ),
            "csrf_same_site_enforcement": require_section(
                proof,
                "csrf_same_site_enforcement",
                {"cross_site_mutations_denied": True},
            ),
            "secret_exposure_redaction": require_section(
                proof,
                "secret_exposure_redaction",
                {"raw_secret_exposure_count": 0},
            ),
            "admin_surface_privacy": require_section(
                proof,
                "admin_surface_privacy",
                {"raw_private_payload_visible": False},
            ),
            "provider_key_containment": require_section(
                proof,
                "provider_key_containment",
                {"frontend_secret_exposure_count": 0},
            ),
            "stripe_live_test_separation": require_section(
                proof,
                "stripe_live_test_separation",
                {"live_mode_isolated": True},
            ),
            "rate_limit_spend_cap": require_section(
                proof,
                "rate_limit_spend_cap",
                {"kill_switch_ready": True},
            ),
            "csp_headers": require_section(proof, "csp_headers", {"csp_present": True}),
            "rbac_tenant_isolation": require_section(
                proof,
                "rbac_tenant_isolation",
                {"cross_tenant_denials": True},
            ),
            "audit_refs": require_section(proof, "audit_refs", {}),
        }
        same_site = str(sections["secure_session_cookie"].get("same_site", "")).lower()
        if same_site not in {"lax", "strict"}:
            raise SourceProbeError("security proof secure_session_cookie.same_site must be lax/strict")
        if public_csp is not None:
            sections["csp_headers"] = public_csp
    except SourceProbeError as exc:
        blockers.append(str(exc))

    if blockers:
        return None, blockers

    data: dict[str, Any] = {
        "schema_version": "stage1.production_security_launch_source.v1",
        "environment": "production",
        "kind": "production_security_launch_source",
        "status": "pass",
        "release_gate_check_id": "production_security_launch_checks",
        "release_sha": release_sha,
        "generated_at": now(),
    }
    data.update(sections)
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "security_source")
    return data, []


def require_proof_object(args: argparse.Namespace, proof_path: Path | None, proof_name: str) -> dict[str, Any]:
    if proof_path is None:
        raise SourceProbeError(f"{proof_name}_missing")
    proof = read_json(proof_path)
    assert_no_secret(proof, proof_name)
    release_sha = str(proof.get("release_sha", "")).strip().lower()
    if release_sha and release_sha != require_release_sha(args.release_sha):
        raise SourceProbeError(f"{proof_name} release_sha does not match requested release")
    return proof


def require_dict(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SourceProbeError(f"{path} must be an object")
    return dict(value)


def require_pass_section_from(parent: dict[str, Any], section: str, path: str) -> dict[str, Any]:
    value = require_dict(parent.get(section), f"{path}.{section}")
    status = str(value.get("status", "")).strip().lower()
    if status not in {"pass", "passed"}:
        raise SourceProbeError(f"{path}.{section}.status must pass")
    refs = value.get("refs", value.get("evidence_refs")) if section == "audit_refs" else value.get("evidence_refs")
    if not isinstance(refs, list) or not refs or not all(isinstance(item, str) and item.strip() for item in refs):
        raise SourceProbeError(f"{path}.{section} evidence refs must be non-empty")
    return value


def build_billing_source(args: argparse.Namespace) -> tuple[dict[str, Any] | None, list[str]]:
    blockers: list[str] = []
    try:
        release_sha = require_release_sha(args.release_sha)
        proof = require_proof_object(args, args.billing_proof, "billing_proof")
        if proof.get("stripe_mode") != "live":
            raise SourceProbeError("billing proof stripe_mode must be live")
        if proof.get("livemode") is not True:
            raise SourceProbeError("billing proof livemode must be true")
        lifecycle = require_dict(proof.get("lifecycle"), "billing_proof.lifecycle")
        refund = require_dict(proof.get("refund_credit_webhook"), "billing_proof.refund_credit_webhook")
        source_lifecycle = {
            section: require_pass_section_from(lifecycle, section, "billing_proof.lifecycle")
            for section in BILLING_LIFECYCLE_SECTIONS
        }
        source_refund = {
            section: require_pass_section_from(refund, section, "billing_proof.refund_credit_webhook")
            for section in BILLING_REFUND_SECTIONS
        }
    except SourceProbeError as exc:
        blockers.append(str(exc))
    if blockers:
        return None, blockers

    data: dict[str, Any] = {
        "schema_version": "stage1.production_billing_source.v1",
        "environment": "production",
        "kind": "production_billing_source",
        "status": "pass",
        "release_gate_check_id": "production_paid_billing_lifecycle",
        "release_sha": release_sha,
        "generated_at": now(),
        "stripe_mode": "live",
        "livemode": True,
        "lifecycle": source_lifecycle,
        "refund_credit_webhook": source_refund,
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "billing_source")
    return data, []


def build_governance_source(args: argparse.Namespace) -> tuple[dict[str, Any] | None, list[str]]:
    blockers: list[str] = []
    try:
        release_sha = require_release_sha(args.release_sha)
        proof = require_proof_object(args, args.governance_proof, "governance_proof")
        components: dict[str, dict[str, Any]] = {}
        for component, (release_gate_check_id, sections) in GOVERNANCE_COMPONENTS.items():
            value = require_dict(proof.get(component), f"governance_proof.{component}")
            if value.get("release_gate_check_id") != release_gate_check_id:
                raise SourceProbeError(f"governance proof {component}.release_gate_check_id mismatch")
            runtime_request_ids = value.get("runtime_request_ids")
            audit_refs = value.get("audit_refs")
            if not isinstance(runtime_request_ids, list) or not runtime_request_ids:
                raise SourceProbeError(f"governance proof {component}.runtime_request_ids must be non-empty")
            if not isinstance(audit_refs, list) or not audit_refs:
                raise SourceProbeError(f"governance proof {component}.audit_refs must be non-empty")
            component_source: dict[str, Any] = {
                "release_gate_check_id": release_gate_check_id,
                "runtime_request_ids": runtime_request_ids,
                "audit_refs": audit_refs,
            }
            for section in sections:
                component_source[section] = require_pass_section_from(value, section, f"governance_proof.{component}")
            components[component] = component_source
    except SourceProbeError as exc:
        blockers.append(str(exc))
    if blockers:
        return None, blockers

    data: dict[str, Any] = {
        "schema_version": "stage1.production_governance_release_source.v1",
        "environment": "production",
        "kind": "production_governance_release_source",
        "status": "pass",
        "release_sha": release_sha,
        "generated_at": now(),
        **components,
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "governance_source")
    return data, []


def blocked_diagnostic(kind: str, release_sha: str, blockers: list[str], production_web_url: str = "") -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": "stage1.production_source_probe.blocked.v1",
        "environment": "production",
        "kind": kind,
        "status": "blocked",
        "release_sha": release_sha if RELEASE_SHA_RE.fullmatch(release_sha or "") else None,
        "generated_at": now(),
        "production_web_url": production_web_url.strip().rstrip("/") or None,
        "canonical_source_written": False,
        "blocked_checks": blockers,
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def write_or_block(
    *,
    source: dict[str, Any] | None,
    blockers: list[str],
    source_path: Path,
    diagnostic_path: Path,
    write_canonical_source: bool,
    kind: str,
    release_sha: str,
    production_web_url: str = "",
) -> int:
    if blockers or source is None:
        write_json(
            diagnostic_path,
            blocked_diagnostic(kind, release_sha, blockers or ["source_not_built"], production_web_url),
        )
        return 2
    if not write_canonical_source:
        write_json(
            diagnostic_path,
            blocked_diagnostic(kind, release_sha, ["write_canonical_source_flag_not_set"], production_web_url),
        )
        return 2
    write_json(source_path, source)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-sha", default="", help="full production release SHA")
    parser.add_argument("--production-web-url", default="", help="production HTTPS web base URL")
    parser.add_argument("--timeout", type=float, default=12.0)
    parser.add_argument("--diagnostic", type=Path, default=DEFAULT_DIAGNOSTIC)
    parser.add_argument("--write-canonical-source", action="store_true")
    parser.add_argument("--legal-support-source", type=Path, default=DEFAULT_LEGAL_SOURCE)
    parser.add_argument("--security-source", type=Path, default=DEFAULT_SECURITY_SOURCE)
    parser.add_argument("--billing-source", type=Path, default=DEFAULT_BILLING_SOURCE)
    parser.add_argument("--governance-source", type=Path, default=DEFAULT_GOVERNANCE_SOURCE)
    parser.add_argument("--security-proof", type=Path, help="sanitized security source-proof JSON")
    parser.add_argument("--billing-proof", type=Path, help="sanitized live billing source-proof JSON")
    parser.add_argument("--governance-proof", type=Path, help="sanitized governance/release source-proof JSON")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--legal-support", action="store_true", help="probe public legal/support pages")
    mode.add_argument("--security", action="store_true", help="assemble production security source from sanitized proof")
    mode.add_argument("--billing", action="store_true", help="assemble production billing source from sanitized live proof")
    mode.add_argument("--governance", action="store_true", help="assemble production governance/release source from sanitized proof")
    mode.add_argument("--contract-only", action="store_true", help="validate script constants without network/file writes")
    return parser.parse_args()


def selected_probe_kind(args: argparse.Namespace) -> str:
    if args.security:
        return "production_security_launch_source_probe"
    if args.billing:
        return "production_billing_source_probe"
    if args.governance:
        return "production_governance_release_source_probe"
    if args.contract_only:
        return "production_source_probe_contract"
    return "production_legal_support_source_probe"


def main() -> int:
    args = parse_args()
    try:
        if args.contract_only:
            for pages in (LEGAL_PAGES, SUPPORT_PAGES):
                for page_id, (_, tokens) in pages.items():
                    if not page_id or len(tokens) < 2:
                        raise SourceProbeError("legal/support page probe token contract is incomplete")
            for section in SECURITY_SECTIONS:
                if not section:
                    raise SourceProbeError("security section contract is incomplete")
            for section in (*BILLING_LIFECYCLE_SECTIONS, *BILLING_REFUND_SECTIONS):
                if not section:
                    raise SourceProbeError("billing section contract is incomplete")
            for component, (_, sections) in GOVERNANCE_COMPONENTS.items():
                if not component or not sections:
                    raise SourceProbeError("governance section contract is incomplete")
            print("stage1 production source probe contract passed")
            return 0
        release_sha = require_release_sha(args.release_sha)
        if args.security:
            source, blockers = build_security_source(args)
            status = write_or_block(
                source=source,
                blockers=blockers,
                source_path=args.security_source,
                diagnostic_path=args.diagnostic,
                write_canonical_source=args.write_canonical_source,
                kind="production_security_launch_source_probe",
                release_sha=release_sha,
                production_web_url=args.production_web_url,
            )
        elif args.billing:
            source, blockers = build_billing_source(args)
            status = write_or_block(
                source=source,
                blockers=blockers,
                source_path=args.billing_source,
                diagnostic_path=args.diagnostic,
                write_canonical_source=args.write_canonical_source,
                kind="production_billing_source_probe",
                release_sha=release_sha,
                production_web_url=args.production_web_url,
            )
        elif args.governance:
            source, blockers = build_governance_source(args)
            status = write_or_block(
                source=source,
                blockers=blockers,
                source_path=args.governance_source,
                diagnostic_path=args.diagnostic,
                write_canonical_source=args.write_canonical_source,
                kind="production_governance_release_source_probe",
                release_sha=release_sha,
                production_web_url=args.production_web_url,
            )
        else:
            source, blockers = build_legal_support_source(args)
            status = write_or_block(
                source=source,
                blockers=blockers,
                source_path=args.legal_support_source,
                diagnostic_path=args.diagnostic,
                write_canonical_source=args.write_canonical_source,
                kind="production_legal_support_source_probe",
                release_sha=release_sha,
                production_web_url=args.production_web_url,
            )
    except SourceProbeError as exc:
        release_sha = str(getattr(args, "release_sha", "")).strip().lower()
        write_json(
            args.diagnostic,
            blocked_diagnostic(
                selected_probe_kind(args),
                release_sha,
                [str(exc)],
                str(getattr(args, "production_web_url", "")),
            ),
        )
        print(f"stage1 production source probe blocked: {exc}", file=sys.stderr)
        return 2

    if status == 0:
        print("stage1 production source probe wrote canonical source")
    else:
        print(f"stage1 production source probe wrote blocked diagnostic: {args.diagnostic}")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
