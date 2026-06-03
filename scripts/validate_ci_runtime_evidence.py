#!/usr/bin/env python3
"""Validate Stage 0 Rev2 CI runtime evidence artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {
    "stage0-rev2-pr-main-run.json": "ci_gate_runtime_execution",
    "stage0-rev2-playwright-smoke.json": "ci_playwright_smoke",
    "stage0-rev2-docker-image-build.json": "ci_docker_image_build",
}


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", default="ops/evidence/ci")
    parser.add_argument("--expect-no-runtime-pass", action="store_true")
    args = parser.parse_args()

    out_dir = ROOT / args.out_dir
    passed = []
    for filename, check_id in REQUIRED.items():
        path = out_dir / filename
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("environment") != "ci":
            fail(f"{filename} must declare environment=ci")
        if data.get("release_gate_check_id") != check_id:
            fail(f"{filename} must target {check_id}")
        refs = data.get("evidence_refs", [])
        if ".github/workflows/stage0-rev2-ci.yml" not in refs:
            fail(f"{filename} must cite installed workflow")
        for ref in refs:
            if not (ROOT / ref).exists():
                fail(f"{filename} evidence ref does not resolve: {ref}")
        if data.get("status") in {"pass", "passed"}:
            blockers = data.get("preserved_blockers") or []
            if blockers:
                fail(f"{filename} passing evidence must not preserve blockers")
            passed.append(filename)

    if args.expect_no_runtime_pass and passed:
        fail(f"unexpected passing runtime evidence present: {passed}")
    print("ci runtime evidence validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
