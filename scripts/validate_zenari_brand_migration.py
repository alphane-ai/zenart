#!/usr/bin/env python3
"""Validate that public legacy brand spellings are not present in repo text."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

IGNORED_DIRS = {
    ".git",
    ".next",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "vendor",
}

IGNORED_NAMES = {
    ".env",
}

SCANNED_SUFFIXES = {
    "",
    ".css",
    ".example",
    ".go",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".sh",
    ".sql",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}


class BrandMigrationError(Exception):
    pass


def legacy_pattern() -> re.Pattern[str]:
    lower = "zen" + "art"
    return re.compile(
        "|".join(
            [
                rf"\b{lower}\.ai\b",
                rf"@{lower}\b",
                rf"\b{lower}_pro\b",
                rf"\burn:{lower}\b",
                rf"\b{lower}\.figma_layout_spec\b",
                rf"\bzen[\s_-]+art\b",
                rf"\b{lower}\b",
            ]
        ),
        re.IGNORECASE,
    )


def iter_scan_roots(args: list[str]) -> list[Path]:
    if args:
        return [(ROOT / arg).resolve() for arg in args]
    return [ROOT]


def should_scan(path: Path) -> bool:
    try:
        rel = path.relative_to(ROOT)
    except ValueError:
        rel = path
    if path.name in IGNORED_NAMES:
        return False
    if path.name.endswith(".tsbuildinfo"):
        return False
    if any(part in IGNORED_DIRS for part in rel.parts):
        return False
    return path.suffix in SCANNED_SUFFIXES


def iter_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if not path.exists():
            raise BrandMigrationError(f"scan path does not exist: {path}")
        if path.is_file():
            if should_scan(path):
                files.append(path)
            continue
        for candidate in path.rglob("*"):
            if candidate.is_file() and should_scan(candidate):
                files.append(candidate)
    return sorted(set(files))


def public_legacy_match(match: re.Match[str]) -> bool:
    value = match.group(0)
    lower = "zen" + "art"
    if value == lower:
        return False
    return True


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def validate(paths: list[Path]) -> None:
    pattern = legacy_pattern()
    hits: list[str] = []
    for path in iter_files(paths):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for line_no, line in enumerate(text.splitlines(), start=1):
            if any(public_legacy_match(match) for match in pattern.finditer(line)):
                hits.append(f"{display_path(path)}:{line_no}: {line.strip()}")
    if hits:
        joined = "\n".join(hits[:100])
        more = "" if len(hits) <= 100 else f"\n... {len(hits) - 100} more"
        raise BrandMigrationError(f"public legacy brand spelling found:\n{joined}{more}")


def main() -> int:
    try:
        validate(iter_scan_roots(sys.argv[1:]))
    except BrandMigrationError as exc:
        print(f"zenari brand migration validation failed: {exc}", file=sys.stderr)
        return 1
    print("zenari brand migration validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
