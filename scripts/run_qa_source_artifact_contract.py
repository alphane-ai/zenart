#!/usr/bin/env python3
"""Run the Stage 0 Rev2 QA source artifact resolution contract."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_qa_result_coverage.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
