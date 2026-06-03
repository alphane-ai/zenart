#!/usr/bin/env python3
"""Promote real Stage 0 Rev2 production runtime artifacts into canonical evidence."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT / "ops" / "evidence" / "production"
CANONICAL = {
    "backup_restore": "backup-restore.json",
    "rollback_incident_smoke": "rollback-incident-post-deploy-smoke.json",
}
CHECK_ID = "production_backup_rollback_incident"


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


def validate_common(path: Path, evidence: dict[str, Any]) -> None:
    if evidence.get("schema_version") != "stage0.rev2":
        raise PromotionError(f"{rel(path)} must use schema_version=stage0.rev2")
    if evidence.get("environment") != "production":
        raise PromotionError(f"{rel(path)} must declare environment=production")
    if evidence.get("status") != "pass":
        raise PromotionError(f"{rel(path)} must be pass; got status={evidence.get('status')!r}")
    if evidence.get("release_gate_check_id") != CHECK_ID:
        raise PromotionError(f"{rel(path)} must target {CHECK_ID}")
    request_ids = evidence.get("runtime_request_ids")
    if not isinstance(request_ids, list) or not request_ids:
        raise PromotionError(f"{rel(path)} must include runtime_request_ids")


def validate_backup_restore(path: Path, evidence: dict[str, Any]) -> None:
    validate_common(path, evidence)
    probe = evidence.get("backup_restore_probe")
    if not isinstance(probe, dict):
        raise PromotionError(f"{rel(path)} lacks backup_restore_probe")
    required_true = [
        "backup_schedule_active",
        "postgres_restore_verified",
        "object_restore_verified",
        "restore_count_match",
        "rpo_within_policy",
        "rto_within_policy",
    ]
    for key in required_true:
        if probe.get(key) is not True:
            raise PromotionError(f"{rel(path)} backup_restore_probe.{key} must be true")
    if not isinstance(probe.get("rpo_minutes"), int) or probe["rpo_minutes"] > 60:
        raise PromotionError(f"{rel(path)} rpo_minutes must be <= 60")
    if not isinstance(probe.get("rto_minutes"), int) or probe["rto_minutes"] > 120:
        raise PromotionError(f"{rel(path)} rto_minutes must be <= 120")
    if not probe.get("audit_refs"):
        raise PromotionError(f"{rel(path)} backup restore must cite audit_refs")
    areas = {item.get("area") for item in evidence.get("coverage", []) if isinstance(item, dict)}
    required = {"backup_schedule", "postgres_restore", "object_restore"}
    if areas != required:
        raise PromotionError(f"{rel(path)} backup restore coverage mismatch: {sorted(areas)}")
    combined = json.dumps(evidence, ensure_ascii=False).lower()
    for token in ["backup", "postgres restore", "object restore", "rpo", "rto", "production"]:
        if token not in combined:
            raise PromotionError(f"{rel(path)} missing backup restore token: {token}")


def validate_rollback_incident_smoke(path: Path, evidence: dict[str, Any]) -> None:
    validate_common(path, evidence)
    probe = evidence.get("rollback_incident_smoke_probe")
    if not isinstance(probe, dict):
        raise PromotionError(f"{rel(path)} lacks rollback_incident_smoke_probe")
    required_true = [
        "app_rollback_verified",
        "feature_flag_rollback_verified",
        "worker_drain_verified",
        "migration_compatibility_verified",
        "incident_alert_path_verified",
        "post_deploy_smoke_verified",
    ]
    for key in required_true:
        if probe.get(key) is not True:
            raise PromotionError(f"{rel(path)} rollback_incident_smoke_probe.{key} must be true")
    if not probe.get("alert_route_ids"):
        raise PromotionError(f"{rel(path)} must include alert_route_ids")
    if not probe.get("incident_ids"):
        raise PromotionError(f"{rel(path)} must include incident_ids")
    areas = {item.get("area") for item in evidence.get("coverage", []) if isinstance(item, dict)}
    required = {"rollback_drill", "migration_compatibility", "incident_alert_path", "post_deploy_smoke"}
    if areas != required:
        raise PromotionError(f"{rel(path)} rollback/incident coverage mismatch: {sorted(areas)}")
    combined = json.dumps(evidence, ensure_ascii=False).lower()
    for token in ["rollback", "incident", "migration compatibility", "post-deploy smoke", "production"]:
        if token not in combined:
            raise PromotionError(f"{rel(path)} missing rollback/incident token: {token}")


def classify(evidence: dict[str, Any]) -> str | None:
    if "backup_restore_probe" in evidence:
        return "backup_restore"
    if "rollback_incident_smoke_probe" in evidence:
        return "rollback_incident_smoke"
    return None


def collect(input_dir: Path) -> dict[str, tuple[Path, dict[str, Any]]]:
    if not input_dir.exists():
        raise PromotionError(f"input artifact directory does not exist: {input_dir}")
    found: dict[str, tuple[Path, dict[str, Any]]] = {}
    for path in sorted(input_dir.rglob("*.json")):
        evidence = load_json(path)
        kind = classify(evidence)
        if kind in CANONICAL:
            found.setdefault(kind, (path, evidence))
    missing = set(CANONICAL) - set(found)
    if missing:
        raise PromotionError(f"missing production runtime artifacts for: {sorted(missing)}")
    return found


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, help="Directory containing real production runtime JSON artifacts.")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Canonical production evidence output directory.")
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
        validate_backup_restore(*found["backup_restore"])
        validate_rollback_incident_smoke(*found["rollback_incident_smoke"])

        planned = [(source_path, out_dir / CANONICAL[kind]) for kind, (source_path, _) in found.items()]
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
        print(f"Production runtime artifact promotion blocked: {exc}", file=sys.stderr)
        return 2

    prefix = "would write" if args.dry_run else "wrote"
    for _, target_path in planned:
        print(f"{prefix} {rel(target_path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
