#!/usr/bin/env python3
"""Sanitize, classify, and refresh Azure Run Command staging evidence."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SANITIZED_OUTPUT = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-ssh-repair.output.txt"
DEFAULT_DIAGNOSIS_OUTPUT = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-ssh-repair-diagnosis.json"
DEFAULT_AZURE_READINESS_OUTPUT = ROOT / "ops" / "evidence" / "staging" / "stage1-azure-origin-readiness.json"
DEFAULT_NEXT_BLOCKERS_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.json"
DEFAULT_NEXT_BLOCKERS_MARKDOWN = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.md"


class IngestError(Exception):
    pass


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def run(parts: list[str], *, input_text: str | None = None, allow_exit_2: bool = False) -> int:
    result = subprocess.run(
        parts,
        cwd=ROOT,
        input=input_text,
        text=True,
        check=False,
    )
    if result.returncode == 0:
        return 0
    if allow_exit_2 and result.returncode == 2:
        return 2
    raise IngestError(f"command failed with exit {result.returncode}: {' '.join(parts)}")


def read_input(path: Path | None) -> str:
    if path is None:
        return sys.stdin.read()
    return path.read_text(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Raw Azure Portal Run Command output. Omit to read stdin.")
    parser.add_argument("--sanitized-output", type=Path, default=DEFAULT_SANITIZED_OUTPUT)
    parser.add_argument("--diagnosis-output", type=Path, default=DEFAULT_DIAGNOSIS_OUTPUT)
    parser.add_argument("--azure-readiness-output", type=Path, default=DEFAULT_AZURE_READINESS_OUTPUT)
    parser.add_argument("--next-blockers-output", type=Path, default=DEFAULT_NEXT_BLOCKERS_OUTPUT)
    parser.add_argument("--next-blockers-markdown", type=Path, default=DEFAULT_NEXT_BLOCKERS_MARKDOWN)
    parser.add_argument("--azure-timeout", default="8", help="Timeout seconds passed to stage1_azure_origin_readiness.py.")
    parser.add_argument("--ssh-hard-timeout", default="20", help="SSH hard timeout seconds passed to stage1_azure_origin_readiness.py.")
    parser.add_argument("--allow-missing-marker", action="store_true", help="Do not require full payload markers during sanitizer step.")
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        source = Path(__file__).read_text(encoding="utf-8")
        for snippet in (
            "sanitize_azure_run_command_output.py",
            "classify_azure_run_command_output.py",
            "stage1_azure_origin_readiness.py",
            "generate_stage1_next_blockers_summary.py",
            "validate_stage1_next_blockers_summary.py",
            "raw_input_persisted=false",
            "azure-run-command-ssh-repair.output.txt",
            "azure-run-command-ssh-repair-diagnosis.json",
            "stage1-next-blockers-summary.json",
            "--azure-readiness",
            "--run-command-diagnosis",
            "--azure-timeout",
            "--ssh-hard-timeout",
        ):
            if snippet not in source:
                raise SystemExit(f"missing ingest contract snippet: {snippet}")
        print("azure run command output ingest contract passed")
        return 0

    raw = read_input(args.input)
    sanitizer_cmd = [
        "python3",
        "scripts/sanitize_azure_run_command_output.py",
        "--output",
        str(args.sanitized_output),
    ]
    if not args.allow_missing_marker:
        sanitizer_cmd.append("--require-marker")
    run(sanitizer_cmd, input_text=raw)

    classify_status = run(
        [
            "python3",
            "scripts/classify_azure_run_command_output.py",
            "--input",
            str(args.sanitized_output),
            "--output",
            str(args.diagnosis_output),
        ],
        allow_exit_2=True,
    )
    readiness_status = run(
        [
            "python3",
            "scripts/stage1_azure_origin_readiness.py",
            "--env",
            ".env",
            "--timeout",
            str(args.azure_timeout),
            "--ssh-hard-timeout",
            str(args.ssh_hard_timeout),
            "--output",
            str(args.azure_readiness_output),
        ],
        allow_exit_2=True,
    )
    run(["python3", "scripts/validate_stage1_azure_origin_readiness.py", "--evidence", str(args.azure_readiness_output)])
    summary_status = run(
        [
            "python3",
            "scripts/generate_stage1_next_blockers_summary.py",
            "--output",
            str(args.next_blockers_output),
            "--markdown",
            str(args.next_blockers_markdown),
            "--azure-readiness",
            str(args.azure_readiness_output),
            "--run-command-diagnosis",
            str(args.diagnosis_output),
        ],
        allow_exit_2=True,
    )
    run(
        [
            "python3",
            "scripts/validate_stage1_next_blockers_summary.py",
            "--summary",
            str(args.next_blockers_output),
            "--markdown",
            str(args.next_blockers_markdown),
            "--azure-readiness",
            str(args.azure_readiness_output),
            "--run-command-diagnosis",
            str(args.diagnosis_output),
        ]
    )

    print(f"azure_run_command_ingest_sanitized_output={display_path(args.sanitized_output)}")
    print(f"azure_run_command_ingest_diagnosis_output={display_path(args.diagnosis_output)}")
    print(f"azure_run_command_ingest_readiness_output={display_path(args.azure_readiness_output)}")
    print(f"azure_run_command_ingest_next_blockers_output={display_path(args.next_blockers_output)}")
    print(f"classifier_exit={classify_status}")
    print(f"readiness_exit={readiness_status}")
    print(f"next_blockers_exit={summary_status}")
    print("raw_input_persisted=false")
    print("release_gate_decision=no_go")
    return 0 if classify_status == 0 and readiness_status == 0 and summary_status == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
