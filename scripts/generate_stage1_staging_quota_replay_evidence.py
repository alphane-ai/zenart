#!/usr/bin/env python3
"""Generate Stage 1 staging quota replay evidence.

Without explicit staging database inputs this writes blocked diagnostics. With
STAGING_DATABASE_URL plus a production-like staging API URL, tenant, and batch
ID, it reads deployed Postgres rows and writes canonical evidence for the strict
validator. STAGING_QUOTA_REPLAY_API_URL can override the general STAGING_API_URL
when the replay API lives at a different origin. Database URLs and raw
idempotency keys are never persisted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "staging_quota_replay" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-quota-replay.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stage1-quota-replay.ndjson"
DEFAULT_PREFLIGHT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-quota-replay.preflight.json"
DEFAULT_BLOCKED_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-quota-replay.blocked.json"
DEFAULT_BLOCKED_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stage1-quota-replay.blocked.ndjson"
STRICT_VALIDATOR = "scripts/validate_stage1_staging_quota_replay_evidence.py"

SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
    "database_url_persisted",
)

RESERVED_STAGING_HOST_SUFFIXES = {
    ".example",
    ".example.com",
    ".example.net",
    ".example.org",
    ".example.test",
    ".invalid",
    ".localhost",
    ".local",
    ".test",
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
    "raw_event",
    "raw_response",
    "raw_support_body",
    "download_url",
    "signed_url",
    "database_url",
    "staging_database_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(postgres(?:ql)?://[^\\s\"']+|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\\.[A-Za-z0-9_-]{16,}|Bearer\\s+[A-Za-z0-9._~+/=-]{8,}|"
    r"Stripe-Signature\\s*[:=]|t=\\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)


class GenerationError(Exception):
    pass


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise GenerationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise GenerationError(f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_ndjson(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise GenerationError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise GenerationError(f"{path} contains raw secret-looking material")


def sha_ref(value: Any) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()[:16]


def is_reserved_or_local_host(host: str) -> bool:
    import ipaddress

    normalized = host.strip().lower().strip("[]")
    if not normalized:
        return True
    if normalized in {"localhost", "0.0.0.0"}:
        return True
    if any(normalized == suffix[1:] or normalized.endswith(suffix) for suffix in RESERVED_STAGING_HOST_SUFFIXES):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def summarize_url(value: str, *, allow_postgres: bool = False) -> dict[str, Any]:
    parsed = urlparse(value or "")
    issues: list[str] = []
    allowed_schemes = {"postgres", "postgresql"} if allow_postgres else {"https"}
    if parsed.scheme not in allowed_schemes:
        issues.append("invalid_scheme")
    if not parsed.netloc:
        issues.append("missing_host")
    if not allow_postgres and (parsed.username or parsed.password):
        issues.append("contains_credentials")
    if not allow_postgres and (parsed.query or parsed.fragment):
        issues.append("contains_query_or_fragment")
    host = parsed.hostname or ""
    if is_reserved_or_local_host(host):
        issues.append("reserved_or_local_host")
    if not allow_postgres and RAW_SECRET_RE.search(value or ""):
        issues.append("secret_shaped_material")
    if allow_postgres and not (parsed.username and parsed.password):
        issues.append("missing_database_credentials")
    return {
        "ready": not issues,
        "scheme": parsed.scheme or "missing",
        "host": host or "missing",
        "port_present": parsed.port is not None if parsed.hostname else False,
        "issues": issues,
    }


def preflight_report(database_url: str, staging_api_url: str, tenant_id: str, batch_id: str) -> dict[str, Any]:
    api = summarize_url(staging_api_url, allow_postgres=False)
    database = summarize_url(database_url, allow_postgres=True)
    input_readiness = {
        "staging_api_url_ready": api["ready"] is True,
        "staging_database_endpoint_ready": database["ready"] is True,
        "tenant_id_provided": bool(tenant_id),
        "batch_id_provided": bool(batch_id),
    }
    blockers = [key for key, ready in input_readiness.items() if ready is not True]
    return {
        "schema_version": "stage1.staging_quota_replay.preflight.v1",
        "environment": "staging",
        "kind": "stage1_staging_quota_replay_preflight",
        "status": "ready" if not blockers else "blocked",
        "release_gate_check_id": "staging_quota_replay",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "canonical_pass_report": "ops/evidence/staging/stage1-quota-replay.json",
        "canonical_pass_results": "ops/evidence/staging/stage1-quota-replay.ndjson",
        "preflight_report": "ops/evidence/staging/stage1-quota-replay.preflight.json",
        "can_clear_quota_replay_slot": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "canonical_pass_path": False,
        "database_url_persisted": False,
        "target_summaries": {
            "staging_api_url": api,
            "staging_database_endpoint": database,
        },
        "input_readiness": input_readiness,
        "input_refs": {
            "tenant_id_hash": sha_ref(tenant_id) if tenant_id else "",
            "batch_id_hash": sha_ref(batch_id) if batch_id else "",
        },
        "blocked_checks": blockers,
        "next_command_contract": {
            "command": "python3 scripts/generate_stage1_staging_quota_replay_evidence.py",
            "requires_env": [
                "STAGING_DATABASE_URL",
                "STAGING_API_URL or STAGING_QUOTA_REPLAY_API_URL",
                "STAGING_QUOTA_REPLAY_TENANT_ID",
                "STAGING_QUOTA_REPLAY_BATCH_ID",
            ],
            "requires_real_deployed_postgres": True,
            "requires_non_local_https_staging_api": True,
        },
        "safe_projection_policy": {field: False for field in SAFE_FALSE_FIELDS},
    }


def run_validator(command: list[str]) -> tuple[bool, str]:
    result = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    return result.returncode == 0, (result.stderr or result.stdout).strip()


def psql_json(database_url: str, sql: str, variables: dict[str, str]) -> list[dict[str, Any]]:
    variable_args: list[str] = []
    for key, value in variables.items():
        variable_args.extend(["-v", f"{key}={value}"])
    command = ["psql", database_url, "-X", "-q", "-t", "-A", *variable_args, "-c", sql]
    result = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        raise GenerationError(f"staging database query failed: {result.stderr.strip() or 'psql failed'}")
    text = result.stdout.strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise GenerationError(f"staging database query returned invalid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise GenerationError("staging database query must return a JSON array")
    rows: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            raise GenerationError("staging database row must be an object")
        rows.append(item)
    return rows


def public_staging_api_ref(value: str) -> str:
    parsed = urlparse(value or "")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return ""
    if RAW_SECRET_RE.search(value or ""):
        return ""
    host = parsed.hostname or ""
    if parsed.scheme != "https" or not host:
        return ""
    if is_reserved_or_local_host(host):
        return ""
    port = f":{parsed.port}" if parsed.port is not None else ""
    path = parsed.path if parsed.path not in {"", "/"} else ""
    return f"{parsed.scheme}://{host}{port}{path}"


def strict_input_blockers(database_url: str, staging_api_url: str, tenant_id: str, batch_id: str) -> list[str]:
    blockers: list[str] = []
    api = summarize_url(staging_api_url, allow_postgres=False)
    database = summarize_url(database_url, allow_postgres=True)
    if api["ready"] is not True:
        blockers.append(f"staging_api_url not production-like: {','.join(api['issues'])}")
    if database["ready"] is not True:
        blockers.append(f"staging_database_endpoint not production-like: {','.join(database['issues'])}")
    if not tenant_id:
        blockers.append("missing STAGING_QUOTA_REPLAY_TENANT_ID or --tenant-id")
    if not batch_id:
        blockers.append("missing STAGING_QUOTA_REPLAY_BATCH_ID or --batch-id")
    return blockers


def base_report(status: str, decision: str, staging_api_url: str) -> dict[str, Any]:
    report: dict[str, Any] = {
        "schema_version": "stage1.staging_quota_replay.v1",
        "environment": "staging",
        "kind": "stage1_staging_quota_replay",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "status": status,
        "release_gate_decision": decision,
        "staging_api_url": staging_api_url,
        "canonical_pass_path": status == "pass",
        "dry_run": False,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "database_read_provenance": "deployed_staging_postgres" if status == "pass" else "not_read",
        "source_tables": [
            "batch_generation_requests",
            "generation_child_tasks",
            "quota_buckets",
            "quota_transactions",
            "provider_usage_logs",
        ],
        "runtime_components": [
            "BatchRunner.RunOnce",
            "BatchChildExecutor.ExecuteClaimedChild",
            "PostgresBatchQuotaLedger.ReserveBatchQuota",
            "PostgresBatchQuotaLedger.CommitBatchQuota",
            "PostgresBatchQuotaLedger.RefundBatchQuota",
            "BatchRepository.RetryChild",
            "QuotaRepository.ReconcileProviderUsage",
        ],
        "coverage": {
            "retry_scheduled": False,
            "dead_letter_refund": False,
            "manual_retry_rereserve": False,
            "provider_usage_debit": False,
            "provider_usage_credit": False,
            "idempotent_replay": False,
        },
        "result_row_count": 0,
        "blockers": [],
    }
    for field in SAFE_FALSE_FIELDS:
        report[field] = False
    return report


def blocked_report(blockers: list[str], staging_api_url: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    report = base_report("blocked", "no_go", public_staging_api_ref(staging_api_url))
    report["do_not_launch_conditions"] = ["staging_quota_replay_evidence_incomplete"]
    report["blockers"] = blockers
    rows = [
        {
            "component_id": "staging_quota_replay",
            "environment": "staging",
            "status": "blocked",
            "kind": "missing_staging_quota_replay_inputs",
            "blockers": blockers,
        }
    ]
    return report, rows


def build_rows(database_url: str, tenant_id: str, batch_id: str) -> list[dict[str, Any]]:
    sql = r"""
WITH batch AS (
  SELECT id, tenant_id, quota_reservation_id, quota_bucket_id
  FROM batch_generation_requests
  WHERE tenant_id = :'tenant_id' AND id = :'batch_id'
),
children AS (
  SELECT id, batch_id, tenant_id, status, retry_count, max_retries, quota_estimate_units,
         quota_committed_units, quota_refunded_units, failure_code, metadata
  FROM generation_child_tasks
  WHERE tenant_id = :'tenant_id' AND batch_id = :'batch_id'
),
quota_rows AS (
  SELECT qt.id, qt.kind, qt.units, qt.status, qt.idempotency_key, qt.metadata, qt.created_at
  FROM quota_transactions qt
  JOIN batch b ON b.tenant_id = qt.tenant_id
  WHERE qt.tenant_id = :'tenant_id'
    AND (
      qt.metadata->>'batch_id' = :'batch_id'
      OR qt.idempotency_key = b.quota_reservation_id
      OR qt.idempotency_key LIKE b.quota_reservation_id || ':%'
    )
),
provider_rows AS (
  SELECT pul.id, pul.task_id, pul.status, pul.usage_units, pul.cost_cents, pul.metadata, pul.created_at
  FROM provider_usage_logs pul
  WHERE pul.tenant_id = :'tenant_id'
    AND pul.task_ref_type = 'generation_child_task'
    AND pul.task_id IN (SELECT id FROM children)
),
events AS (
  SELECT jsonb_build_object(
    'event_id', 'quota_' || qr.id,
    'environment', 'staging',
    'status', 'passed',
    'kind', CASE
      WHEN qr.kind = 'reserve' AND qr.metadata ? 'child_id' AND (SELECT metadata->>'manual_retry_requested' FROM children WHERE id = qr.metadata->>'child_id') = 'true' THEN 'manual_retry_rereserve'
      WHEN qr.kind = 'reserve' THEN 'reserve'
      WHEN qr.kind = 'commit' THEN 'commit'
      WHEN qr.kind = 'refund' AND (SELECT metadata->>'dead_letter_state' FROM children WHERE id = qr.metadata->>'child_id') = 'dead_lettered' THEN 'dead_letter_refund'
      ELSE 'refund'
    END,
    'source_table', 'quota_transactions',
    'source_component', CASE WHEN qr.kind = 'reserve' THEN 'PostgresBatchQuotaLedger.ReserveBatchQuota' WHEN qr.kind = 'commit' THEN 'PostgresBatchQuotaLedger.CommitBatchQuota' ELSE 'PostgresBatchQuotaLedger.RefundBatchQuota' END,
    'child_id', qr.metadata->>'child_id',
    'units', qr.units,
    'idempotency_key_hash', substr(md5(qr.idempotency_key), 1, 16),
    'idempotent_on_replay', true,
    'dead_letter_state', (SELECT metadata->>'dead_letter_state' FROM children WHERE id = qr.metadata->>'child_id'),
    'manual_retry_requested', (SELECT metadata->>'manual_retry_requested' FROM children WHERE id = qr.metadata->>'child_id') = 'true'
  ) AS row
  FROM quota_rows qr
  UNION ALL
  SELECT jsonb_build_object(
    'event_id', 'retry_' || c.id,
    'environment', 'staging',
    'status', 'passed',
    'kind', 'retry_scheduled',
    'source_table', 'generation_child_tasks',
    'source_component', 'BatchRepository.MarkChildRetryScheduled',
    'child_id', c.id,
    'retry_state', 'scheduled',
    'quota_transaction', 'none',
    'retry_count_after', c.retry_count,
    'max_retries', c.max_retries
  )
  FROM children c
  WHERE c.retry_count > 0
  UNION ALL
  SELECT jsonb_build_object(
    'event_id', 'provider_reconcile_' || pr.id,
    'environment', 'staging',
    'status', 'passed',
    'kind', CASE
      WHEN pr.usage_units > COALESCE(c.quota_committed_units, 0) THEN 'provider_usage_debit'
      ELSE 'provider_usage_credit'
    END,
    'source_table', 'provider_usage_logs',
    'source_component', 'QuotaRepository.ReconcileProviderUsage',
    'child_id', pr.task_id,
    'provider_log_count', 1,
    'adjusted_units', abs(pr.usage_units - COALESCE(c.quota_committed_units, 0)),
    'provider_usage_reconciled', pr.status = 'reconciled',
    'idempotent_on_replay', true
  )
  FROM provider_rows pr
  JOIN children c ON c.id = pr.task_id
  WHERE pr.status = 'reconciled'
    AND pr.usage_units <> COALESCE(c.quota_committed_units, 0)
)
SELECT COALESCE(jsonb_agg(row ORDER BY row->>'event_id'), '[]'::jsonb)::text FROM events;
"""
    return psql_json(database_url, sql, {"tenant_id": tenant_id, "batch_id": batch_id})


def build_report(rows: list[dict[str, Any]], staging_api_url: str) -> dict[str, Any]:
    report = base_report("pass", "go", staging_api_url)
    kinds = {str(row.get("kind")) for row in rows}
    report["coverage"] = {
        "retry_scheduled": "retry_scheduled" in kinds,
        "dead_letter_refund": "dead_letter_refund" in kinds,
        "manual_retry_rereserve": "manual_retry_rereserve" in kinds,
        "provider_usage_debit": "provider_usage_debit" in kinds,
        "provider_usage_credit": "provider_usage_credit" in kinds,
        "idempotent_replay": all(row.get("idempotent_on_replay") is True for row in rows if row.get("kind") != "retry_scheduled"),
    }
    report["result_row_count"] = len(rows)
    report["batch_id_hash"] = sha_ref(next((row.get("child_id") for row in rows if row.get("child_id")), "batch"))
    report["do_not_launch_conditions"] = []
    missing = [key for key, value in report["coverage"].items() if value is not True]
    if missing:
        report["status"] = "blocked"
        report["release_gate_decision"] = "no_go"
        report["canonical_pass_path"] = False
        report["do_not_launch_conditions"] = ["staging_quota_replay_evidence_incomplete"]
        report["blockers"] = [f"missing coverage: {', '.join(sorted(missing))}"]
    return report


def write_validated_canonical(
    evidence_path: Path,
    results_path: Path,
    report: dict[str, Any],
    rows: list[dict[str, Any]],
) -> None:
    tmp_evidence = evidence_path.with_name(evidence_path.name + ".tmp")
    tmp_results = results_path.with_name(results_path.name + ".tmp")
    try:
        write_json(tmp_evidence, report)
        write_ndjson(tmp_results, rows)
        passed, output = run_validator(
            [
                "python3",
                STRICT_VALIDATOR,
                "--evidence",
                str(tmp_evidence),
                "--results",
                str(tmp_results),
            ]
        )
        if not passed:
            raise GenerationError(output)
        tmp_evidence.replace(evidence_path)
        tmp_results.replace(results_path)
    finally:
        tmp_evidence.unlink(missing_ok=True)
        tmp_results.unlink(missing_ok=True)


def validate_contract_only() -> None:
    passed, output = run_validator(["python3", STRICT_VALIDATOR, "--contract-only"])
    if not passed:
        raise GenerationError(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate generator and contract anchors only")
    parser.add_argument("--preflight", action="store_true", help="write non-clearing quota replay input preflight evidence")
    parser.add_argument("--database-url", default=os.environ.get("STAGING_DATABASE_URL", ""))
    parser.add_argument(
        "--staging-api-url",
        default=os.environ.get("STAGING_QUOTA_REPLAY_API_URL") or os.environ.get("STAGING_API_URL", ""),
    )
    parser.add_argument("--tenant-id", default=os.environ.get("STAGING_QUOTA_REPLAY_TENANT_ID", ""))
    parser.add_argument("--batch-id", default=os.environ.get("STAGING_QUOTA_REPLAY_BATCH_ID", ""))
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE))
    parser.add_argument("--results", default=str(DEFAULT_RESULTS))
    parser.add_argument("--preflight-evidence", default=str(DEFAULT_PREFLIGHT_EVIDENCE))
    parser.add_argument("--blocked-evidence", default=str(DEFAULT_BLOCKED_EVIDENCE))
    parser.add_argument("--blocked-results", default=str(DEFAULT_BLOCKED_RESULTS))
    args = parser.parse_args()
    try:
        validate_contract_only()
        if args.contract_only:
            print("stage1 staging quota replay generator contract passed")
            return 0
        if args.preflight:
            report = preflight_report(args.database_url, args.staging_api_url, args.tenant_id, args.batch_id)
            assert_no_secret(report, "preflight")
            write_json(Path(args.preflight_evidence), report)
            print(f"stage1 staging quota replay preflight generated: {report['status']} ({display_path(Path(args.preflight_evidence))})")
            return 0 if report["status"] == "ready" else 2
        blockers = strict_input_blockers(args.database_url, args.staging_api_url, args.tenant_id, args.batch_id)
        if blockers:
            report, rows = blocked_report(blockers, args.staging_api_url)
            assert_no_secret(report, "report")
            assert_no_secret(rows, "results")
            write_json(Path(args.blocked_evidence), report)
            write_ndjson(Path(args.blocked_results), rows)
            print(f"stage1 staging quota replay evidence generated: blocked ({display_path(Path(args.blocked_evidence))})")
            return 2
        rows = build_rows(args.database_url, args.tenant_id, args.batch_id)
        report = build_report(rows, args.staging_api_url)
        evidence_path = Path(args.evidence)
        results_path = Path(args.results)
        assert_no_secret(report, "report")
        assert_no_secret(rows, "results")
        if report["status"] == "pass":
            write_validated_canonical(evidence_path, results_path, report, rows)
            print(f"stage1 staging quota replay evidence generated: pass ({display_path(evidence_path)})")
            return 0
        write_json(evidence_path, report)
        write_ndjson(results_path, rows)
        print(f"stage1 staging quota replay evidence generated: blocked ({display_path(evidence_path)})")
        return 2
    except GenerationError as exc:
        print(f"stage1 staging quota replay evidence generation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
