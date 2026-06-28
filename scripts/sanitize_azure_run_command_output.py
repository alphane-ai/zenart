#!/usr/bin/env python3
"""Sanitize Azure Portal Run Command output before storing local evidence."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-ssh-repair.output.txt"
REDACTION_MARKER = "[redacted]"
SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("cloudflare_api_token", re.compile(r"cfat_[A-Za-z0-9_-]{20,}")),
    ("openai_or_project_key", re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}", re.IGNORECASE)),
    ("stripe_key", re.compile(r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b")),
    ("stripe_webhook_secret", re.compile(r"\bwhsec_[A-Za-z0-9]{16,}\b")),
    ("zai_key", re.compile(r"\b[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}\b", re.IGNORECASE)),
    ("bearer_token", re.compile(r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}", re.IGNORECASE)),
    ("postgres_url", re.compile(r"postgres(?:ql)?://[^\s'\"<>]+", re.IGNORECASE)),
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL)),
    ("aws_signature", re.compile(r"X-Amz-Signature=[A-Za-z0-9%]+", re.IGNORECASE)),
    ("google_access_id", re.compile(r"GoogleAccessId=[A-Za-z0-9%._@-]+", re.IGNORECASE)),
    ("authorization_header", re.compile(r"(?im)^(\s*Authorization\s*[:=]\s*).+$")),
    ("cookie_header", re.compile(r"(?im)^(\s*(?:Cookie|Set-Cookie)\s*[:=]\s*).+$")),
    ("secret_assignment", re.compile(r"(?im)^(\s*[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Za-z0-9_]*\s*=\s*).+$")),
)
REQUIRED_MARKERS = (
    "zenari_azure_run_command_payload=ssh_repair_v1",
    "origin_diagnostics_begin",
    "zenari_azure_run_command_payload=complete",
)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def sanitize_text(text: str) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    sanitized = text
    for name, pattern in SECRET_PATTERNS:
        def replace(match: re.Match[str]) -> str:
            counts[name] = counts.get(name, 0) + 1
            if match.lastindex:
                return f"{match.group(1)}{REDACTION_MARKER}"
            return REDACTION_MARKER

        sanitized = pattern.sub(replace, sanitized)
    return sanitized, counts


def read_input(path: Path | None) -> str:
    if path is None:
        return sys.stdin.read()
    return path.read_text(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Raw Azure Portal output file. Omit to read stdin.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--require-marker", action="store_true", help="Fail if expected Run Command markers are absent.")
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        source = Path(__file__).read_text(encoding="utf-8")
        for snippet in (
            "cfat_",
            "Bearer",
            "postgres",
            "PRIVATE KEY",
            "Authorization",
            "Set-Cookie",
            "azure-run-command-ssh-repair.output.txt",
            "zenari_azure_run_command_payload=complete",
        ):
            if snippet not in source:
                raise SystemExit(f"missing sanitizer contract snippet: {snippet}")
        print("azure run command output sanitizer contract passed")
        return 0

    raw = read_input(args.input)
    sanitized, counts = sanitize_text(raw)
    if args.require_marker:
        missing = [marker for marker in REQUIRED_MARKERS if marker not in sanitized]
        if missing:
            raise SystemExit(f"missing required Azure Run Command marker(s): {', '.join(missing)}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(sanitized, encoding="utf-8")
    print(f"azure_run_command_output_sanitized={display_path(args.output)}")
    print(f"redaction_count={sum(counts.values())}")
    if counts:
        print("redaction_categories=" + ",".join(sorted(counts)))
    print("raw_output_persisted=false")
    print("next=python3 scripts/classify_azure_run_command_output.py --input ops/evidence/staging/azure-run-command-ssh-repair.output.txt --output ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json || test $? -eq 2")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
