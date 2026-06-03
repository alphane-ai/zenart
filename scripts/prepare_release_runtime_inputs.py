#!/usr/bin/env python3
"""Prepare Stage 0 Rev2 runtime input directories from the input manifest.

This script intentionally creates only directories and README files. It does
not create JSON evidence artifacts, so it cannot satisfy release gates by
itself.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "ops" / "evidence" / "release" / "runtime-input-manifest.json"
DEFAULT_ARTIFACT_ROOT = ROOT / "ops" / "evidence" / "runtime-inputs"


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def resolve(path: str | Path) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else ROOT / candidate


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"{rel(path)} must contain a JSON object")
    if data.get("schema_version") != "stage0.rev2.release_runtime_input_manifest":
        raise SystemExit(f"{rel(path)} is not a Stage 0 Rev2 runtime input manifest")
    return data


def rewrite_input_dir(input_dir: str, artifact_root: Path | None) -> Path:
    if artifact_root is None:
        return resolve(input_dir)
    suffix = Path(input_dir).name
    return artifact_root / suffix


def readme_text(gate: str, requirements: list[dict[str, Any]]) -> str:
    lines = [
        f"# Stage 0 Rev2 Runtime Inputs: {gate}",
        "",
        "This directory is for source runtime artifacts only.",
        "Do not place generated canonical evidence here unless a promoter expects it.",
        "This README is not runtime evidence and cannot close a release gate.",
        "",
        "## Required Inputs",
        "",
    ]
    for item in requirements:
        lines.extend(
            [
                f"- Gate/check: `{item['gate']}.{item['check_id']}`",
                f"  - blocker_kind: `{item['blocker_kind']}`",
                f"  - deferred: `{str(item['deferred']).lower()}`",
                f"  - operator_command: `{item['operator_command']}`",
                "  - evidence:",
            ]
        )
        for evidence in item.get("evidence", []):
            lines.append(
                "    - "
                f"{evidence.get('action')}: `{evidence.get('canonical_path')}` "
                f"({evidence.get('reason')})"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def build_report(manifest: dict[str, Any], artifact_root: Path | None, apply: bool) -> dict[str, Any]:
    by_dir: dict[Path, list[dict[str, Any]]] = {}
    for requirement in manifest.get("requirements", []):
        input_dir = rewrite_input_dir(str(requirement.get("input_dir") or ""), artifact_root)
        by_dir.setdefault(input_dir, []).append(requirement)

    planned_dirs = []
    for input_dir, requirements in sorted(by_dir.items(), key=lambda item: str(item[0])):
        gate_names = sorted({str(item.get("gate")) for item in requirements})
        readme_path = input_dir / "README.md"
        planned_dirs.append(
            {
                "input_dir": rel(input_dir),
                "readme": rel(readme_path),
                "gates": gate_names,
                "requirement_count": len(requirements),
            }
        )
        if apply:
            input_dir.mkdir(parents=True, exist_ok=True)
            readme_path.write_text(readme_text(",".join(gate_names), requirements), encoding="utf-8")

    return {
        "schema_version": "stage0.rev2.release_runtime_input_workspace",
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "source_manifest": manifest.get("schema_version"),
        "mode": "apply" if apply else "dry_run_non_mutating",
        "applied": apply,
        "mutation_policy": "creates_only_input_directories_and_readmes_not_runtime_evidence",
        "planned_directory_count": len(planned_dirs),
        "directories": planned_dirs,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--artifact-root", default=str(DEFAULT_ARTIFACT_ROOT))
    parser.add_argument("--out", help="Optional JSON workspace report path.")
    parser.add_argument("--apply", action="store_true", help="Create directories and README files.")
    parser.add_argument("--stdout", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    manifest = load_json(resolve(args.manifest))
    artifact_root = resolve(args.artifact_root) if args.artifact_root else None
    report = build_report(manifest, artifact_root, args.apply)
    if args.out:
        out = resolve(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.stdout:
        print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
