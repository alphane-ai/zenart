#!/usr/bin/env python3
"""Generate Stage 1 release metadata preflight evidence.

The preflight centralizes the release bundle metadata inputs that are otherwise
passed through environment variables. It does not clear staging or production
gates; it only records whether release SHA, notes, image refs, and validator-
readable staging evidence refs are present and semantically usable.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "release_metadata" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-release-metadata-preflight.json"
DEFAULT_CI_DOCKER_EVIDENCE = ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-docker-image-build.json"
PASS_STATUSES = {"pass", "passed"}
RELEASE_IMAGE_NAMES = {"backend", "web", "admin"}
FORBIDDEN_RELEASE_IMAGE_NAMES = {"manager", "worker", "crawler", "migrate"}

SAFE_FALSE_FIELDS = {
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
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
}

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)

EVIDENCE_REF_KEYS = {
    "evidence_ref",
    "evidence_refs",
    "report_path",
    "report_paths",
    "source_report",
    "source_reports",
    "query_ref",
    "dashboard_url",
    "dashboard_uid",
    "alert_rule_url",
    "trace_id",
    "log_query",
    "metrics_query",
    "artifact_path",
    "artifact_paths",
    "run_url",
    "run_urls",
    "scan_report",
    "scan_reports",
    "smoke_report",
    "load_report",
    "rollback_report",
}

NAMED_CONTRACTS: dict[str, dict[str, set[str]]] = {
    "observability": {
        "request_id_propagation": {"request_id_propagation", "request_id"},
        "structured_json_logs": {"structured_json_logs", "structured_logs", "json_logs"},
        "opentelemetry_traces": {"opentelemetry_traces", "otel_traces", "traces"},
        "backend_worker_crawler_metrics": {"backend_worker_crawler_metrics", "metrics"},
        "dashboard_import": {"dashboard_import", "dashboard_runtime", "dashboards"},
        "alert_routes": {"alert_routes", "alert_runtime", "alerts"},
    },
    "backup_restore": {
        "postgres_restore": {"postgres_restore", "postgres_restore_drill", "database_restore"},
        "object_restore": {"object_restore", "object_restore_drill", "exported_package_object_restore"},
    },
    "load": {
        "chat_task": {"chat_task", "chat_task_load"},
        "worker_generation": {"worker_generation", "worker_generation_load"},
        "zip_export": {"zip_export", "export_package", "zip_export_load"},
        "signed_download": {"signed_download", "signed_download_load"},
        "crawler_throttle": {"crawler_throttle", "crawler_throttle_load"},
        "quota_contention": {"quota_contention", "quota_contention_load"},
        "workspace_rendering": {"workspace_rendering", "workspace_rendering_load"},
    },
    "rollback": {
        "image_rollback": {"image_rollback", "image_promote_previous_sha"},
        "feature_flag_rollback": {"feature_flag_rollback", "flag_rollback"},
        "migration_compatibility": {"migration_compatibility", "forward_repair", "db_compatibility"},
        "worker_drain": {"worker_drain", "worker_pause_resume"},
        "post_rollback_smoke": {"post_rollback_smoke", "rollback_smoke"},
    },
    "security_scan": {
        "dependency_scan": {"dependency_scan", "deps", "npm_go_vulncheck"},
        "image_scan": {"image_scan", "docker_image_scan", "container_scan"},
        "secret_scan": {"secret_scan", "committed_secret_scan"},
    },
}


class ReleaseMetadataError(Exception):
    pass


def repo_path(ref: str) -> Path:
    path = Path(ref)
    if not path.is_absolute():
        path = ROOT / path
    try:
        path.resolve().relative_to(ROOT.resolve())
    except ValueError as exc:
        raise ReleaseMetadataError(f"path escapes repo root: {ref}") from exc
    return path


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ReleaseMetadataError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ReleaseMetadataError(f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ReleaseMetadataError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ReleaseMetadataError(f"{path} contains raw secret-looking material")


def collect_sha_values(value: Any) -> list[str]:
    values: list[str] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in {"release_sha", "git_sha", "commit_sha", "sha"} and isinstance(nested, str):
                values.append(nested)
            values.extend(collect_sha_values(nested))
    elif isinstance(value, list):
        for item in value:
            values.extend(collect_sha_values(item))
    return values


def normalized_token(value: Any) -> str:
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def direct_string_values(value: Any, keys: set[str]) -> list[str]:
    if not isinstance(value, dict):
        return []
    return [str(nested) for key, nested in value.items() if key in keys and isinstance(nested, str)]


def collect_named_entries(parsed: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    for container_key in ("signals", "checks", "drills", "restore_drills", "modes", "scans", "steps"):
        container = parsed.get(container_key)
        if isinstance(container, dict):
            for key, value in container.items():
                if isinstance(value, dict):
                    entries[normalized_token(key)] = value
        elif isinstance(container, list):
            for item in container:
                if not isinstance(item, dict):
                    continue
                name = (
                    item.get("name")
                    or item.get("signal")
                    or item.get("signal_id")
                    or item.get("check_id")
                    or item.get("drill_id")
                    or item.get("id")
                )
                if name:
                    entries[normalized_token(name)] = item
    return entries


def entry_passed(entry: dict[str, Any], accepted_statuses: set[str]) -> bool:
    status_values = [
        normalized_token(value)
        for value in direct_string_values(entry, {"status", "result", "runtime_status"})
    ]
    accepted = {normalized_token(value) for value in accepted_statuses}
    return any(value in accepted for value in status_values)


def classify_evidence_ref(ref: str) -> dict[str, Any]:
    value = str(ref).strip()
    if not value:
        return {"ref": value, "kind": "empty", "exists": False}
    if value.startswith(("http://", "https://")):
        return {"ref": value, "kind": "url", "exists": None}
    path = repo_path(value)
    return {
        "ref": value,
        "kind": "local_file" if path.exists() else "artifact_pointer",
        "path": display_path(path),
        "exists": path.exists(),
    }


def collect_evidence_refs(entry: Any) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    if not isinstance(entry, dict):
        return refs
    for key, value in entry.items():
        if key in EVIDENCE_REF_KEYS:
            values = value if isinstance(value, list) else [value]
            for item in values:
                if isinstance(item, str) and item.strip():
                    classified = classify_evidence_ref(item)
                    classified["field"] = key
                    refs.append(classified)
        if isinstance(value, dict):
            refs.extend(collect_evidence_refs(value))
        elif isinstance(value, list):
            for item in value:
                refs.extend(collect_evidence_refs(item))
    return refs


def validate_named_contract(parsed: dict[str, Any], required_aliases: dict[str, set[str]], accepted_statuses: set[str]) -> dict[str, Any]:
    entries = collect_named_entries(parsed)
    result: dict[str, Any] = {
        "required": sorted(required_aliases),
        "present": sorted(entries),
        "missing": [],
        "not_passed": [],
        "missing_evidence_ref": [],
        "evidence_refs": {},
        "verified": False,
    }
    for requirement, aliases in required_aliases.items():
        entry = next((entries[normalized_token(alias)] for alias in aliases if normalized_token(alias) in entries), None)
        if entry is None:
            result["missing"].append(requirement)
            continue
        if not entry_passed(entry, accepted_statuses):
            result["not_passed"].append(requirement)
        refs = collect_evidence_refs(entry)
        result["evidence_refs"][requirement] = refs
        if not refs:
            result["missing_evidence_ref"].append(requirement)
    result["evidence_ref_counts"] = {key: len(value) for key, value in result["evidence_refs"].items()}
    result["verified"] = not result["missing"] and not result["not_passed"] and not result["missing_evidence_ref"]
    return result


def parse_image_refs(raw: str | list[str]) -> list[str]:
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    return [value.strip() for value in str(raw or "").split(",") if value.strip()]


def current_git_head() -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (OSError, subprocess.CalledProcessError):
        return ""
    return completed.stdout.strip().lower()


def blank_image_refs_source(source_ref: str) -> dict[str, Any]:
    return {
        "source": "manual_input",
        "ref": "",
        "ci_docker_evidence_ref": source_ref,
        "provided_by_manual_input": False,
        "derived_from_ci_docker_evidence": False,
        "source_verified": False,
        "reason": "manual_image_refs_missing_and_ci_docker_evidence_not_used",
    }


def pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def false_value(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.strip().lower() in {"false", "0", "no"})


def derive_image_refs_from_ci_docker_evidence(
    release_sha: str,
    required_images: list[str],
    source_ref: str,
) -> tuple[list[str], dict[str, Any]]:
    source: dict[str, Any] = {
        "source": "ci_docker_evidence",
        "ref": source_ref,
        "ci_docker_evidence_ref": source_ref,
        "provided_by_manual_input": False,
        "derived_from_ci_docker_evidence": False,
        "source_verified": False,
        "required_images": required_images,
        "reason": "",
    }
    if not release_sha:
        source["reason"] = "release_sha_missing"
        return [], source
    try:
        path = repo_path(source_ref)
    except ReleaseMetadataError as exc:
        source["reason"] = str(exc)
        return [], source
    source["path"] = display_path(path)
    source["exists"] = path.exists()
    if not path.exists() or not path.is_file():
        source["reason"] = "ci_docker_evidence_not_found"
        return [], source
    try:
        parsed = load_json(path)
    except ReleaseMetadataError as exc:
        source["reason"] = str(exc)
        return [], source
    assert_no_secret(parsed, "ci_docker_evidence")

    checks = {
        "schema_version": parsed.get("schema_version") == "stage1.ci_docker_image_build.v1",
        "environment_ci": parsed.get("environment") == "ci",
        "kind": parsed.get("kind") == "ci_docker_image_build",
        "status_pass": pass_status(parsed.get("status")),
        "release_sha_match": parsed.get("release_sha") == release_sha,
        "canonical_pass_path": parsed.get("canonical_pass_path") is True,
        "dry_run_false": false_value(parsed.get("dry_run")),
        "local_devport_debug_false": false_value(parsed.get("local_devport_debug")),
        "allow_local_devport_evidence_false": false_value(parsed.get("allow_local_devport_evidence")),
    }
    for field in SAFE_FALSE_FIELDS:
        checks[f"{field}_false"] = parsed.get(field) is False
    gate = parsed.get("gate_impact")
    checks["gate_impact_can_clear_ci_gate_check"] = (
        isinstance(gate, dict)
        and gate.get("release_gate_check_id") == "ci_docker_image_build"
        and gate.get("can_clear_ci_gate_check") is True
    )

    images = parsed.get("images")
    image_refs: list[str] = []
    image_checks: dict[str, Any] = {}
    if not isinstance(images, dict):
        checks["images_object"] = False
        source["checks"] = checks
        source["image_checks"] = image_checks
        source["reason"] = "ci_docker_evidence_images_not_object"
        return [], source
    checks["images_object"] = True
    image_key_set = set(images)
    checks["release_image_closed_set"] = image_key_set == RELEASE_IMAGE_NAMES
    forbidden_image_keys = sorted(image_key_set & FORBIDDEN_RELEASE_IMAGE_NAMES)
    if forbidden_image_keys:
        source["forbidden_image_keys"] = forbidden_image_keys
    missing_required = [name for name in required_images if name not in images]
    if missing_required:
        checks["required_images_present"] = False
        source["checks"] = checks
        source["image_checks"] = image_checks
        source["missing_required_images"] = missing_required
        source["reason"] = "ci_docker_evidence_missing_required_images"
        return [], source
    checks["required_images_present"] = True

    image_names = [name for name in ("backend", "web", "admin") if name in images]
    for name in image_names:
        image = images.get(name)
        image_result = {
            "status_pass": False,
            "digest_sha256": False,
            "tag_has_release_sha": False,
            "verified": False,
        }
        if isinstance(image, dict):
            tag = str(image.get("tag") or f"ghcr.io/alphane-ai/zenari-{name}:{release_sha}").strip()
            digest = str(image.get("digest") or "").strip()
            image_result["tag"] = tag
            image_result["digest"] = digest
            image_result["status_pass"] = pass_status(image.get("status"))
            image_result["digest_sha256"] = digest.startswith("sha256:") and len(digest) >= 71
            image_result["tag_has_release_sha"] = release_sha in tag or release_sha[:12] in tag
            image_result["verified"] = (
                image_result["status_pass"] is True
                and image_result["digest_sha256"] is True
                and image_result["tag_has_release_sha"] is True
            )
            if image_result["verified"]:
                image_refs.append(f"{tag}@{digest}")
        image_checks[name] = image_result

    required_image_checks = [image_checks.get(name, {}) for name in required_images]
    checks["required_images_passed_with_digest"] = all(item.get("verified") is True for item in required_image_checks)
    failed_checks = [key for key, value in checks.items() if value is not True]
    failed_required_images = [
        name for name in required_images if image_checks.get(name, {}).get("verified") is not True
    ]
    source["checks"] = checks
    source["image_checks"] = image_checks
    source["derived_refs"] = image_refs
    source["source_verified"] = not failed_checks and not failed_required_images
    source["derived_from_ci_docker_evidence"] = source["source_verified"]
    if failed_checks:
        source["failed_checks"] = failed_checks
    if failed_required_images:
        source["failed_required_images"] = failed_required_images
    if source["source_verified"] is True:
        source["reason"] = "derived_from_strict_ci_docker_evidence"
        return image_refs, source
    source["reason"] = "ci_docker_evidence_failed_strict_checks"
    return [], source


def resolve_image_refs(inputs: dict[str, Any], contract: dict[str, Any], release_sha: str) -> None:
    manual_refs = list(inputs.get("image_refs", []))
    ci_docker_evidence = str(inputs.get("ci_docker_evidence") or display_path(DEFAULT_CI_DOCKER_EVIDENCE)).strip()
    forbidden_manual_refs = [
        ref for ref in manual_refs
        if any(f"zenari-{name}" in ref or f"/{name}" in ref or f"-{name}:" in ref for name in FORBIDDEN_RELEASE_IMAGE_NAMES)
    ]
    if manual_refs:
        inputs["image_refs_source"] = {
            "source": "manual_input",
            "ref": "IMAGE_REFS",
            "ci_docker_evidence_ref": ci_docker_evidence,
            "provided_by_manual_input": True,
            "derived_from_ci_docker_evidence": False,
            "source_verified": not forbidden_manual_refs,
            "forbidden_manual_refs": forbidden_manual_refs,
            "reason": "manual_image_refs_provided" if not forbidden_manual_refs else "manual_image_refs_include_non_release_images",
        }
        return
    required_images = [str(item) for item in contract.get("required_image_names", [])]
    derived_refs, source = derive_image_refs_from_ci_docker_evidence(
        release_sha,
        required_images,
        ci_docker_evidence,
    )
    if derived_refs:
        inputs["image_refs"] = derived_refs
        inputs["image_refs_source"] = source
        return
    inputs["image_refs_source"] = source if ci_docker_evidence else blank_image_refs_source(ci_docker_evidence)


def validate_release_notes(value: str, release_sha: str, sections: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "slot": "release_notes_path",
        "ref": value,
        "provided": bool(value),
        "exists": False,
        "sha_match": False,
        "verified": False,
        "required_fragments": sections,
        "missing_fragments": sections[:],
        "unresolved_placeholders": [],
        "decision_recorded": False,
    }
    if not value:
        result["reason"] = "missing_ref"
        return result
    path = repo_path(value)
    result["path"] = display_path(path)
    if not path.exists() or not path.is_file():
        result["reason"] = "local_file_not_found"
        return result
    text = path.read_text(encoding="utf-8", errors="replace")
    result["exists"] = True
    result["sha_match"] = bool(release_sha) and release_sha in text
    result["missing_fragments"] = [fragment for fragment in sections if fragment not in text]
    result["unresolved_placeholders"] = sorted(set(re.findall(r"<[^>\n]+>", text)))
    result["decision_recorded"] = "- Decision:" in text or "Decision:" in text
    result["verified"] = (
        result["sha_match"] is True
        and not result["missing_fragments"]
        and not result["unresolved_placeholders"]
        and result["decision_recorded"] is True
    )
    if not result["sha_match"]:
        result["reason"] = "release_notes_do_not_reference_release_sha"
    elif result["missing_fragments"]:
        result["reason"] = "release_notes_missing_required_sections"
    elif result["unresolved_placeholders"]:
        result["reason"] = "release_notes_have_unresolved_placeholders"
    elif result["decision_recorded"] is not True:
        result["reason"] = "release_notes_missing_go_no_go_decision"
    return result


def validate_image_refs(refs: list[str], release_sha: str, required_images: list[str]) -> dict[str, Any]:
    sha_tokens = [release_sha]
    if len(release_sha) >= 12:
        sha_tokens.append(release_sha[:12])
    result: dict[str, Any] = {
        "slot": "image_refs",
        "refs": refs,
        "provided": bool(refs),
        "required_images": required_images,
        "release_sha": release_sha,
        "sha_tokens": [token for token in sha_tokens if token],
        "missing_images": [],
        "forbidden_images": [],
        "refs_without_release_sha": [],
        "verified": False,
    }
    if not refs:
        result["reason"] = "missing_image_refs"
        result["missing_images"] = required_images
        return result
    if not release_sha:
        result["reason"] = "missing_release_sha"
        result["missing_images"] = [name for name in required_images if not any(name in ref for ref in refs)]
        result["refs_without_release_sha"] = refs
        return result
    result["missing_images"] = [name for name in required_images if not any(name in ref for ref in refs)]
    result["forbidden_images"] = [
        name
        for name in sorted(FORBIDDEN_RELEASE_IMAGE_NAMES)
        if any(f"zenari-{name}" in ref or f"/{name}" in ref or f"-{name}:" in ref for ref in refs)
    ]
    result["refs_without_release_sha"] = [ref for ref in refs if not any(token and token in ref for token in sha_tokens)]
    result["verified"] = not result["missing_images"] and not result["forbidden_images"] and not result["refs_without_release_sha"]
    if not result["verified"]:
        result["reason"] = "image_refs_missing_required_images_or_release_sha"
        if result["forbidden_images"]:
            result["reason"] = "image_refs_include_non_release_images"
    return result


def validate_staging_evidence(
    slot: str,
    value: str,
    release_sha: str,
    expected_kind: str,
    accepted_statuses: list[str],
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "slot": slot,
        "ref": value,
        "provided": bool(value),
        "exists": False,
        "sha_match": False,
        "verified": False,
        "expected_evidence_kind": expected_kind,
        "accepted_statuses": sorted(accepted_statuses),
        "required_environment": "staging",
        "semantic_checks": {
            "json_parseable": False,
            "release_sha_present": bool(release_sha),
            "release_sha_match": False,
            "environment_staging": False,
            "evidence_kind_match": False,
            "status_accepted": False,
        },
    }
    if not value:
        result["reason"] = "missing_ref"
        return result
    path = repo_path(value)
    result["path"] = display_path(path)
    if not path.exists() or not path.is_file():
        result["reason"] = "local_file_not_found"
        return result
    result["exists"] = True
    try:
        parsed = load_json(path)
    except ReleaseMetadataError as exc:
        result["reason"] = str(exc)
        return result
    assert_no_secret(parsed, f"{slot}.evidence")
    sha_values = collect_sha_values(parsed)
    result["sha_values"] = sha_values
    result["sha_match"] = bool(release_sha) and release_sha in sha_values
    status_values = [item.lower() for item in direct_string_values(parsed, {"status", "result", "runtime_status"})]
    environment_values = [item.lower() for item in direct_string_values(parsed, {"environment", "env"})]
    kind_values = [item.lower() for item in direct_string_values(parsed, {"kind", "evidence_kind", "type", "evidence_type"})]
    result["status_values"] = status_values
    result["environment_values"] = environment_values
    result["evidence_kind_values"] = kind_values
    result["semantic_checks"] = {
        "json_parseable": True,
        "release_sha_present": bool(release_sha),
        "release_sha_match": result["sha_match"] is True,
        "environment_staging": "staging" in environment_values,
        "evidence_kind_match": expected_kind in kind_values,
        "status_accepted": any(status in accepted_statuses for status in status_values),
    }
    missing_semantics = [key for key, passed in result["semantic_checks"].items() if passed is not True]
    if expected_kind in NAMED_CONTRACTS:
        key = f"{expected_kind}_contract"
        result[key] = validate_named_contract(parsed, NAMED_CONTRACTS[expected_kind], set(accepted_statuses) | {"validated"})
        if result[key]["verified"] is not True:
            missing_semantics.append(key)
    result["verified"] = not missing_semantics
    if missing_semantics:
        result["reason"] = f"{slot}_failed_semantic_checks:{','.join(missing_semantics)}"
    return result


def env_or_args(args: argparse.Namespace) -> dict[str, Any]:
    explicit_release_sha = args.release_sha or os.environ.get("RELEASE_SHA") or os.environ.get("GITHUB_SHA") or ""
    git_head = current_git_head()
    return {
        "release_sha": explicit_release_sha or git_head,
        "release_sha_source": "explicit" if explicit_release_sha else ("git_head" if git_head else "missing"),
        "current_git_head": git_head,
        "release_tag": args.release_tag or os.environ.get("RELEASE_TAG") or "",
        "release_notes_path": args.release_notes_path or os.environ.get("RELEASE_NOTES_PATH") or "",
        "image_refs": parse_image_refs(args.image_refs or os.environ.get("IMAGE_REFS") or ""),
        "ci_docker_evidence": args.ci_docker_evidence or os.environ.get("CI_DOCKER_IMAGE_BUILD_EVIDENCE") or display_path(DEFAULT_CI_DOCKER_EVIDENCE),
        "migration_evidence": args.migration_evidence or os.environ.get("MIGRATION_EVIDENCE") or "",
        "config_diff_evidence": args.config_diff_evidence or os.environ.get("CONFIG_DIFF_EVIDENCE") or "",
        "observability_evidence": args.observability_evidence or os.environ.get("OBSERVABILITY_EVIDENCE") or "",
        "backup_restore_evidence": args.backup_restore_evidence or os.environ.get("BACKUP_RESTORE_EVIDENCE") or "",
        "load_evidence": args.load_evidence or os.environ.get("LOAD_EVIDENCE") or "",
        "rollback_evidence": args.rollback_evidence or os.environ.get("ROLLBACK_EVIDENCE") or "",
        "security_scan_evidence": args.security_scan_evidence or os.environ.get("SECURITY_SCAN_EVIDENCE") or "",
    }


def build_report(inputs: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    assert_no_secret(inputs, "inputs")
    release_sha = str(inputs["release_sha"]).strip()
    current_head = str(inputs.get("current_git_head") or "").strip()
    resolve_image_refs(inputs, contract, release_sha)
    slot_results: dict[str, Any] = {}
    slot_results["release_sha"] = {
        "slot": "release_sha",
        "value_present": bool(release_sha),
        "provided": bool(release_sha),
        "verified": bool(re.fullmatch(r"[0-9a-f]{40}", release_sha)),
    }
    if not slot_results["release_sha"]["verified"]:
        slot_results["release_sha"]["reason"] = "release_sha_missing_or_not_full_sha"
    slot_results["release_notes_path"] = validate_release_notes(
        str(inputs["release_notes_path"]).strip(),
        release_sha,
        [str(item) for item in contract.get("required_release_notes_sections", [])],
    )
    slot_results["image_refs"] = validate_image_refs(
        list(inputs["image_refs"]),
        release_sha,
        [str(item) for item in contract.get("required_image_names", [])],
    )
    expected_kinds = contract.get("required_evidence_kinds", {})
    accepted = contract.get("accepted_statuses_by_slot", {})
    for slot in (
        "migration_evidence",
        "config_diff_evidence",
        "observability_evidence",
        "backup_restore_evidence",
        "load_evidence",
        "rollback_evidence",
        "security_scan_evidence",
    ):
        slot_results[slot] = validate_staging_evidence(
            slot,
            str(inputs[slot]).strip(),
            release_sha,
            str(expected_kinds.get(slot)),
            [str(item) for item in accepted.get(slot, [])],
        )

    missing_slots = [slot for slot, result in slot_results.items() if result.get("provided") is not True]
    unverified_slots = [slot for slot, result in slot_results.items() if result.get("verified") is not True]
    blocking_reasons = [f"missing_release_metadata:{slot}" for slot in missing_slots]
    blocking_reasons.extend(f"unverified_release_metadata:{slot}" for slot in unverified_slots)
    metadata_complete = not missing_slots and not unverified_slots
    report: dict[str, Any] = {
        "schema_version": "stage1.release_metadata_preflight.v1",
        "kind": "stage1_release_metadata_preflight",
        "environment": "staging",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "status": "passed" if metadata_complete else "blocked",
        "metadata_complete": metadata_complete,
        "release_gate_decision": "no_go",
        "release_sha": release_sha,
        "release_sha_source": str(inputs.get("release_sha_source") or "missing"),
        "current_git_head": current_head,
        "current_git_head_match": bool(current_head and release_sha == current_head),
        "release_tag": str(inputs["release_tag"]).strip(),
        "release_notes_path": str(inputs["release_notes_path"]).strip(),
        "image_refs": list(inputs["image_refs"]),
        "image_refs_source": inputs["image_refs_source"],
        "evidence_refs": {
            slot: str(inputs[slot]).strip()
            for slot in (
                "migration_evidence",
                "config_diff_evidence",
                "observability_evidence",
                "backup_restore_evidence",
                "load_evidence",
                "rollback_evidence",
                "security_scan_evidence",
            )
        },
        "slot_results": slot_results,
        "missing_slots": missing_slots,
        "unverified_slots": unverified_slots,
        "blocking_reason_count": len(blocking_reasons),
        "blocking_reasons": blocking_reasons,
        "gate_impact": {
            "can_clear_stage1_staging_runtime_gate": False,
            "can_clear_stage1_production_launch_gate": False,
            "preserved_release_gate_check_id": "staging_observability_backup_load",
            "preserved_do_not_launch_condition_id": "stage1_release_metadata_incomplete"
            if not metadata_complete
            else None,
        },
    }
    for field in SAFE_FALSE_FIELDS:
        report[field] = False
    assert_no_secret(report, "report")
    return report


def validate_contract_only() -> None:
    contract = load_json(CONTRACT)
    assert_no_secret(contract, "contract")
    required = {
        "release_sha",
        "release_notes_path",
        "image_refs",
        "migration_evidence",
        "config_diff_evidence",
        "observability_evidence",
        "backup_restore_evidence",
        "load_evidence",
        "rollback_evidence",
        "security_scan_evidence",
    }
    if contract.get("schema_version") != "stage1.release_metadata.contract.v1":
        raise ReleaseMetadataError("contract schema_version mismatch")
    if contract.get("canonical_evidence_path") != "ops/evidence/release/staging/stage1-release-metadata-preflight.json":
        raise ReleaseMetadataError("contract canonical evidence path mismatch")
    if not required <= set(contract.get("required_slots") or []):
        raise ReleaseMetadataError("contract missing required release metadata slots")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate generator contract without writing evidence")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="output evidence JSON path")
    parser.add_argument("--release-sha", default="")
    parser.add_argument("--release-tag", default="")
    parser.add_argument("--release-notes-path", default="")
    parser.add_argument("--image-refs", default="")
    parser.add_argument("--ci-docker-evidence", default="")
    parser.add_argument("--migration-evidence", default="")
    parser.add_argument("--config-diff-evidence", default="")
    parser.add_argument("--observability-evidence", default="")
    parser.add_argument("--backup-restore-evidence", default="")
    parser.add_argument("--load-evidence", default="")
    parser.add_argument("--rollback-evidence", default="")
    parser.add_argument("--security-scan-evidence", default="")
    args = parser.parse_args()
    try:
        validate_contract_only()
        if args.contract_only:
            print("stage1 release metadata generator contract passed")
            return 0
        contract = load_json(CONTRACT)
        report = build_report(env_or_args(args), contract)
        evidence_path = Path(args.evidence)
        if not evidence_path.is_absolute():
            evidence_path = ROOT / evidence_path
        write_json(evidence_path, report)
    except ReleaseMetadataError as exc:
        print(f"stage1 release metadata preflight generation failed: {exc}", file=sys.stderr)
        return 1
    print(f"stage1 release metadata preflight generated: {report['status']} ({display_path(evidence_path)})")
    return 0 if report["status"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
