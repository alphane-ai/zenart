#!/usr/bin/env python3
"""Validate Stage 1 FE-9 mention parser/picker local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "mentions" / "local_contract.json"
MENTIONS = ROOT / "web" / "lib" / "mentions.ts"
MENTIONS_TEST = ROOT / "web" / "lib" / "mentions.test.ts"
WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

REQUIRED_TYPES = {"object", "asset", "brand", "skill", "model"}


class MentionsContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise MentionsContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise MentionsContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.mentions.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "mention_parser_picker_local_contract", "fixture kind mismatch")
    require({"FE-9", "FE-8", "BE-10", "VF-2"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(set(data.get("required_types") or []) == REQUIRED_TYPES, "required mention types mismatch")
    require(
        set(data.get("required_functions") or [])
        == {"parseMentionTokens", "buildMentionPickerOptions", "resolveMentions", "mentionSummary"},
        "required function set mismatch",
    )
    policy = data.get("safe_projection_policy")
    require(isinstance(policy, dict), "safe_projection_policy must be object")
    require(policy.get("raw_prompt_persisted") is False, "raw prompt must not be persisted")
    require(policy.get("internal_model_allowed") is False, "internal model mention must not be allowed")
    require(policy.get("duplicates_projected_once") is True, "duplicates must be projected once")
    require(policy.get("unresolved_mentions_block_model_projection") is True, "unresolved model mentions must block model projection")
    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_mention_contract") == "pass", "local mention contract status mismatch")
    require(status.get("staging_prompt_composer_evidence") == "open", "staging evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local mention contract must not clear staging gate")


def validate_code() -> None:
    text = require_text(
        MENTIONS,
        (
            'export type MentionType = "object" | "asset" | "brand" | "skill" | "model"',
            "export type MentionToken",
            "export type MentionOption",
            "export type MentionResolution",
            "export type MentionParseResult",
            "export const mentionTypes",
            "const mentionPattern",
            "export const buildMentionPickerOptions",
            "export const parseMentionTokens",
            "export const resolveMentions",
            "export const mentionSummary",
            "duplicateCount",
            "forbiddenModelMentions",
            "allowed: item.validation.state === \"accepted\"",
            "allowed: item.status === \"active\" && item.reusable && !item.archived",
            "allowed: item.status === \"active\"",
        ),
    )
    for mention_type in REQUIRED_TYPES:
        require(f'"{mention_type}"' in text, f"mentions.ts missing type literal {mention_type}")


def validate_tests() -> None:
    require_text(
        MENTIONS_TEST,
        (
            "parses object, asset, brand, skill, and model mentions with Chinese and spaces",
            "resolves mentions through picker options and deduplicates repeated refs",
            "keeps unresolved mentions and blocks non-allowed model mentions from projection",
            "@object[Confirmed Brief]",
            "@asset[Primary logo reference]",
            "@brand[Aurora Retail]",
            "@skill[Ecommerce Growth Pack]",
            "@model[image-fast-v1]",
            "@asset[不存在的素材]",
            "internal-shadow-model",
        ),
    )


def validate_workspace() -> None:
    require_text(
        WORKSPACE,
        (
            "buildMentionPickerOptions",
            "resolveMentions",
            "mentionSummary",
            "stage1.mention-parser-picker-local-contract",
            "data-mention-token-count",
            "data-mention-unique-count",
            "data-mention-duplicate-count",
            "data-mention-unresolved-count",
            "data-mention-forbidden-model-count",
            "data-mention-picker-types",
            "data-mention-picker-option-count",
            "data-mention-projected-ids",
            "ecommerce_growth_pack",
            "image-fast-v1",
        ),
    )


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "FE-9",
            "validate_stage1_mentions_contract.py",
            "fixtures/stage1/mentions/local_contract.json",
            "web/lib/mentions.ts",
            "mention parser",
            "staging prompt composer evidence remains open",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_mentions_contract.py",
            "python3 scripts/validate_stage1_mentions_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_code()
    validate_tests()
    validate_workspace()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except MentionsContractError as exc:
        print(f"stage1 mentions contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 mentions contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
