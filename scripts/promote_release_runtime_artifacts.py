#!/usr/bin/env python3
"""Run all Stage 0 Rev2 runtime artifact promoters as one strict release gate preflight."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


PROMOTERS = {
    "ci": ROOT / "scripts" / "promote_ci_runtime_artifacts.py",
    "staging": ROOT / "scripts" / "promote_staging_runtime_artifacts.py",
    "production": ROOT / "scripts" / "promote_production_runtime_artifacts.py",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ci-input-dir", required=True, help="Downloaded GitHub Actions CI artifact directory.")
    parser.add_argument("--staging-input-dir", required=True, help="Real staging probe artifact directory.")
    parser.add_argument("--production-input-dir", required=True, help="Real production runtime artifact directory.")
    parser.add_argument("--ci-out-dir", default="ops/evidence/ci", help="Canonical CI evidence output directory.")
    parser.add_argument("--staging-out-dir", default="ops/evidence/staging", help="Canonical staging evidence output directory.")
    parser.add_argument("--production-out-dir", default="ops/evidence/production", help="Canonical production evidence output directory.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print planned outputs without writing.")
    parser.add_argument("--copy-raw", action="store_true", help="Copy validated source artifacts into raw/ directories.")
    return parser


def run_promoter(name: str, input_dir: str, out_dir: str, dry_run: bool, copy_raw: bool) -> tuple[int, str]:
    cmd = [
        sys.executable,
        str(PROMOTERS[name]),
        "--input-dir",
        input_dir,
        "--out-dir",
        out_dir,
    ]
    if dry_run:
        cmd.append("--dry-run")
    if copy_raw:
        cmd.append("--copy-raw")
    result = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, check=False)
    output = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
    return result.returncode, output


def main() -> int:
    args = build_parser().parse_args()
    inputs = {
        "ci": (args.ci_input_dir, args.ci_out_dir),
        "staging": (args.staging_input_dir, args.staging_out_dir),
        "production": (args.production_input_dir, args.production_out_dir),
    }

    blocked: list[str] = []
    for name, (input_dir, out_dir) in inputs.items():
        code, output = run_promoter(name, input_dir, out_dir, args.dry_run, args.copy_raw)
        print(f"== {name} runtime artifact promotion ==")
        if output:
            print(output)
        print(f"status={code}")
        if code != 0:
            blocked.append(name)

    if blocked:
        print(
            "Release runtime artifact promotion blocked: "
            + ", ".join(blocked)
            + " promoter(s) did not produce canonical pass evidence",
            file=sys.stderr,
        )
        return 2
    print("Release runtime artifact promotion passed for CI, staging, and production canonical evidence")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
