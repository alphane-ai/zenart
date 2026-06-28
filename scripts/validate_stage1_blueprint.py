#!/usr/bin/env python3
"""Validate the Stage 1 execution blueprint structure."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"

EXPECTED_COUNTS = {
    "R": 8,
    "FE": 16,
    "AD": 14,
    "BE": 14,
    "WK": 12,
    "PR": 10,
    "AS": 12,
    "BL": 11,
    "QA": 9,
    "OP": 14,
    "VF": 8,
}

REQUIRED_MARKERS = (
    "zenari.ai Stage 1",
    "Do-Not-Launch",
    "bash scripts/stripe_sandbox_selftest.sh",
    "docker compose --env-file .env.example config --quiet",
    "用户端不管理 provider",
    "backend/worker 异步并发 fan-out",
    "业务发布面固定为三端",
    "release image 闭集只能是 `web`、`admin`、`backend`",
    "不得新增 `manager`、`worker`、`crawler`、`migrate`",
    "worker/crawler/migrate 只能作为 backend runtime/build proof",
    "manager 不得成为 production deploy artifact",
)

ID_RE = re.compile(r"^(R|FE|AD|BE|WK|PR|AS|BL|QA|OP|VF)-([1-9][0-9]*)$")
FORBIDDEN_RELEASE_IMAGE_PATTERNS = (
    r"\bmanager\b[^.\n|]{0,80}\b(?:release image|docker image|image build|deploy artifact)",
    r"\bworker\b[^.\n|]{0,80}\b(?:release image|docker image|image build|deploy artifact)",
    r"\bcrawler\b[^.\n|]{0,80}\b(?:release image|docker image|image build|deploy artifact)",
    r"\bmigrate\b[^.\n|]{0,80}\b(?:release image|docker image|image build|deploy artifact)",
    r"(?:release image|docker image|image build|deploy artifact)[^.\n|]{0,80}\b(?:manager|worker|crawler|migrate)\b",
)


class Stage1BlueprintError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1BlueprintError(message)


def parse_rows(text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) < 8:
            continue
        item_id = cells[0]
        if not ID_RE.match(item_id):
            continue
        command = "|".join(cells[6:-1]).strip()
        rows.append(
            {
                "line": str(line_no),
                "id": item_id,
                "deps": cells[1],
                "scope": cells[2],
                "tech": cells[3],
                "implementation": cells[4],
                "evidence": cells[5],
                "command": command,
                "size": cells[-1],
            }
        )
    return rows


def dependency_ids(deps: str) -> list[str]:
    if deps in {"无", "none", "-"}:
        return []
    tokens = re.split(r"[,，]\s*", deps)
    return [token.strip() for token in tokens if token.strip()]


def validate(path: Path) -> None:
    require(path.exists(), f"missing blueprint: {path.relative_to(ROOT)}")
    text = path.read_text(encoding="utf-8")

    for marker in REQUIRED_MARKERS:
        require(marker in text, f"blueprint missing required marker: {marker}")
    for pattern in FORBIDDEN_RELEASE_IMAGE_PATTERNS:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            context = text[max(0, match.start() - 32) : min(len(text), match.end() + 32)]
            snippet = " ".join(context.split())
            if any(allowed in snippet for allowed in ("not a standalone", "禁止", "不能成为", "不得", "不作为", "只能作为")):
                continue
            raise Stage1BlueprintError(f"blueprint appears to promote non-release image wording: {snippet}")

    rows = parse_rows(text)
    require(rows, "blueprint has no parseable checklist rows")

    ids = [row["id"] for row in rows]
    unique_ids = set(ids)
    require(len(unique_ids) == len(ids), "blueprint has duplicate checklist IDs")
    expected_total = sum(EXPECTED_COUNTS.values())
    require(len(rows) == expected_total, f"blueprint checklist count = {len(rows)}, want {expected_total}")
    require(f"本蓝图包含 {expected_total} 个执行项" in text, "blueprint summary count must match checklist rows")
    require(f"本文件 {expected_total} 个 checklist item" in text, "blueprint final acceptance count must match checklist rows")

    for prefix, expected_count in EXPECTED_COUNTS.items():
        actual = sorted(int(row["id"].split("-")[1]) for row in rows if row["id"].startswith(prefix + "-"))
        expected = list(range(1, expected_count + 1))
        require(actual == expected, f"{prefix} checklist IDs = {actual}, want {expected}")

    for row in rows:
        line = row["line"]
        for field in ("scope", "tech", "implementation", "evidence", "command", "size"):
            require(row[field], f"{row['id']} line {line} has empty {field}")
        require("<= 2000 LOC" in row["size"], f"{row['id']} line {line} must keep <= 2000 LOC scale")
        require("`" in row["command"], f"{row['id']} line {line} validation command must be machine-readable/backticked")
        for dep in dependency_ids(row["deps"]):
            require(dep in unique_ids, f"{row['id']} line {line} depends on unknown item {dep}")

    require("R-8" in unique_ids and "VF-8" in unique_ids, "blueprint must include root scope guard and final validation items")
    require("scripts/stage1_scope_guard.py" in text, "blueprint must reference stage1_scope_guard.py")
    require("scripts/validate_stage1_blueprint.py" in text, "blueprint must reference validate_stage1_blueprint.py")


def main() -> int:
    path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_BLUEPRINT
    try:
        validate(path)
    except Stage1BlueprintError as exc:
        print(f"stage1 blueprint validation failed: {exc}", file=sys.stderr)
        return 1
    print(f"stage1 blueprint validation passed: {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
