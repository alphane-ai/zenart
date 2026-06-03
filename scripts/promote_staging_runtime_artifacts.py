#!/usr/bin/env python3
"""Promote real Stage 0 Rev2 staging probe artifacts into canonical evidence."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT / "ops" / "evidence" / "staging"
CANONICAL = {
    "object_storage_retention_cleanup": "object-storage-retention-cleanup.json",
    "legal_pages_external_user_visibility": "legal-pages-external-user.json",
    "support_contact_external_user_visibility": "support-contact-external-user.json",
}
EXPECTED_RELEASE_GATE = {
    "object_storage_retention_cleanup": "staging_object_storage_signed_downloads",
    "legal_pages_external_user_visibility": "staging_legal_external_user_pages",
    "support_contact_external_user_visibility": "staging_legal_external_user_pages",
}
EXPECTED_CONDITION = {
    "object_storage_retention_cleanup": "object_storage_signed_retention_runtime_missing",
    "legal_pages_external_user_visibility": "external_user_legal_pages_missing",
    "support_contact_external_user_visibility": "external_user_legal_pages_missing",
}
LEGAL_AREAS = {
    "legal_pages_external_user_visibility": {
        "terms",
        "privacy",
        "acceptable_use",
        "ip_complaint",
        "ai_content_disclaimer",
    },
    "support_contact_external_user_visibility": {"support_contact", "billing_policy"},
}


class PromotionError(Exception):
    pass


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PromotionError(f"{rel(path)} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise PromotionError(f"{rel(path)} must contain a JSON object")
    return data


def require_external_staging_url(value: str, context: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise PromotionError(f"{context} must be an absolute HTTP(S) staging URL")
    host = (parsed.hostname or "").lower()
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local"):
        raise PromotionError(f"{context} must be external staging URL, not localhost/.local: {value}")


def validate_common(path: Path, evidence: dict[str, Any], kind: str) -> None:
    if evidence.get("environment") != "staging":
        raise PromotionError(f"{rel(path)} must declare environment='staging'")
    if evidence.get("kind") != kind:
        raise PromotionError(f"{rel(path)} has kind={evidence.get('kind')!r}; expected {kind!r}")
    if evidence.get("status") != "pass":
        raise PromotionError(f"{rel(path)} must be pass; got status={evidence.get('status')!r}")
    if evidence.get("release_gate_check_id") != EXPECTED_RELEASE_GATE[kind]:
        raise PromotionError(f"{rel(path)} targets wrong release_gate_check_id")
    if evidence.get("do_not_launch_condition_id") != EXPECTED_CONDITION[kind]:
        raise PromotionError(f"{rel(path)} targets wrong do_not_launch_condition_id")


def validate_object_retention(path: Path, evidence: dict[str, Any]) -> None:
    validate_common(path, evidence, "object_storage_retention_cleanup")
    if evidence.get("schema_version") != "stage0.rev2.staging.object_storage_retention_cleanup":
        raise PromotionError(f"{rel(path)} has wrong object retention schema")
    probe = evidence.get("probe")
    if not isinstance(probe, dict):
        raise PromotionError(f"{rel(path)} lacks probe object")
    if probe.get("status") != "pass" or probe.get("probe_mode") != "external_http":
        raise PromotionError(f"{rel(path)} must contain a passing external_http probe")
    require_external_staging_url(str(probe.get("url") or ""), f"{rel(path)} probe.url")
    if probe.get("reason") != "ok":
        raise PromotionError(f"{rel(path)} probe reason must be ok")
    if probe.get("release_sha_observed") != evidence.get("release_sha"):
        raise PromotionError(f"{rel(path)} probe release_sha_observed must match release_sha")
    areas = {item.get("area") for item in evidence.get("coverage", []) if isinstance(item, dict)}
    required = {"retention_policy", "expired_export_cleanup", "orphan_cleanup", "audit_refs"}
    if areas != required:
        raise PromotionError(f"{rel(path)} object retention coverage areas mismatch: {sorted(areas)}")
    combined = json.dumps(evidence, ensure_ascii=False).lower()
    for token in ["external cleanup endpoint proof passed", "expired export cleanup", "orphan cleanup", "au-007", "au-012"]:
        if token not in combined:
            raise PromotionError(f"{rel(path)} missing required object retention token: {token}")
    gate_impact = evidence.get("gate_impact")
    if not isinstance(gate_impact, dict):
        raise PromotionError(f"{rel(path)} lacks gate_impact")
    if gate_impact.get("can_clear_retention_cleanup_checklist_item") is not True:
        raise PromotionError(f"{rel(path)} must clear retention cleanup checklist item")
    if gate_impact.get("can_clear_release_gate_check") is not True:
        raise PromotionError(f"{rel(path)} must clear the object-storage release gate check")


def validate_legal_support(path: Path, evidence: dict[str, Any], kind: str) -> None:
    validate_common(path, evidence, kind)
    if evidence.get("schema_version") != "stage0.rev2.staging.legal_support_visibility":
        raise PromotionError(f"{rel(path)} has wrong legal/support schema")
    require_external_staging_url(str(evidence.get("web_url") or ""), f"{rel(path)} web_url")
    coverage = evidence.get("coverage")
    if not isinstance(coverage, list) or len(coverage) != 1:
        raise PromotionError(f"{rel(path)} must include one coverage row")
    results = coverage[0].get("results")
    if not isinstance(results, list) or not results:
        raise PromotionError(f"{rel(path)} must include per-route results")
    result_ids = {str(item.get("check_id")) for item in results if isinstance(item, dict)}
    missing = LEGAL_AREAS[kind] - result_ids
    if missing:
        raise PromotionError(f"{rel(path)} missing route checks: {sorted(missing)}")
    for item in results:
        if item.get("status") != "passed" or item.get("http_status") != 200:
            raise PromotionError(f"{rel(path)} has non-passing route result: {item.get('check_id')}")
        require_external_staging_url(str(item.get("url") or ""), f"{rel(path)} route {item.get('check_id')} url")
    gate_impact = evidence.get("gate_impact")
    if not isinstance(gate_impact, dict):
        raise PromotionError(f"{rel(path)} lacks gate_impact")
    if gate_impact.get("can_clear_check_level_item") is not True:
        raise PromotionError(f"{rel(path)} must clear its check-level item")
    if gate_impact.get("can_clear_release_gate_check") is not False:
        raise PromotionError(f"{rel(path)} split evidence must not clear combined gate alone")


def collect(input_dir: Path) -> dict[str, tuple[Path, dict[str, Any]]]:
    if not input_dir.exists():
        raise PromotionError(f"input artifact directory does not exist: {input_dir}")
    found: dict[str, tuple[Path, dict[str, Any]]] = {}
    for path in sorted(input_dir.rglob("*.json")):
        evidence = load_json(path)
        kind = evidence.get("kind")
        if kind in CANONICAL:
            found.setdefault(str(kind), (path, evidence))
    missing = set(CANONICAL) - set(found)
    if missing:
        raise PromotionError(f"missing staging runtime artifacts for: {sorted(missing)}")
    return found


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, help="Directory containing real staging probe JSON artifacts.")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Canonical staging evidence output directory.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print planned outputs without writing.")
    parser.add_argument("--copy-raw", action="store_true", help="Copy validated source JSON files into raw/ for audit.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    input_dir = Path(args.input_dir)
    if not input_dir.is_absolute():
        input_dir = ROOT / input_dir
    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir

    try:
        found = collect(input_dir)
        object_path, object_evidence = found["object_storage_retention_cleanup"]
        validate_object_retention(object_path, object_evidence)
        for kind in ["legal_pages_external_user_visibility", "support_contact_external_user_visibility"]:
            path, evidence = found[kind]
            validate_legal_support(path, evidence, kind)

        planned: list[tuple[Path, Path]] = [
            (source_path, out_dir / CANONICAL[kind])
            for kind, (source_path, _) in found.items()
        ]
        if not args.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            for source_path, target_path in planned:
                shutil.copy2(source_path, target_path)
            if args.copy_raw:
                raw_dir = out_dir / "raw"
                raw_dir.mkdir(parents=True, exist_ok=True)
                for source_path, _ in planned:
                    shutil.copy2(source_path, raw_dir / source_path.name)
    except PromotionError as exc:
        print(f"Staging runtime artifact promotion blocked: {exc}", file=sys.stderr)
        return 2

    prefix = "would write" if args.dry_run else "wrote"
    for _, target_path in planned:
        print(f"{prefix} {rel(target_path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
