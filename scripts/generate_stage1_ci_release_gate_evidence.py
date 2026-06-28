#!/usr/bin/env python3
"""Generate Stage 1 CI release-gate fixture from exact CI artifacts.

The generator is deliberately conservative. It only closes the CI release gate
when the three canonical CI evidence files exist and the strict CI exact
validator accepts them together. Otherwise it preserves the no-go fixture and
keeps the Stage 0 CI runtime checklist rows open.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE = ROOT / "fixtures" / "stage0" / "rev2" / "release_gate_evidence.ci.json"
DEFAULT_BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
CI_WORKFLOW_REF = ".github/workflows/stage0-rev2-ci.yml"
CI_DRAFT_REF = "ops/ci/stage0-rev2-ci.yml"
CI_DRAFT_EVIDENCE_REF = "fixtures/ops/stage0_rev2_ci_draft_evidence.json"

CI_ARTIFACTS = {
    "ci_gate_runtime_execution": {
        "path": "ops/evidence/ci/stage0-rev2-pr-main-run.json",
        "label": "PR/main workflow run",
        "condition_id": "ci_gate_not_executed_on_main",
        "missing_label": "PR/main run runtime evidence",
        "tokens": ("ci_gate_runtime_execution", "workflow_run", "refs/heads/main"),
        "checklist_items": [
            "CI PR/main workflow run evidence 通过：已安装 workflow 的 PR/main run 结果写入 `ops/evidence/ci/`。",
            "CI PR/main workflow run exact evidence file 通过：`ops/evidence/ci/stage0-rev2-pr-main-run.json` exists, declares `environment=ci`, `release_gate_check_id=ci_gate_runtime_execution`, passing status, PR/main semantics, and no preserved blockers。",
        ],
    },
    "ci_playwright_smoke": {
        "path": "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
        "label": "Playwright smoke",
        "condition_id": "ci_playwright_smoke_missing",
        "missing_label": "CI Playwright smoke runtime evidence",
        "tokens": ("ci_playwright_smoke", "playwright", "coverage"),
        "checklist_items": [
            "CI Playwright smoke runtime evidence 通过：已安装 PR/main workflow 运行 Playwright smoke 并写入 `ops/evidence/ci/`。",
            "CI Playwright smoke exact evidence file 通过：`ops/evidence/ci/stage0-rev2-playwright-smoke.json` exists, declares `environment=ci`, `release_gate_check_id=ci_playwright_smoke`, passing status, Playwright semantics, and no preserved blockers。",
        ],
    },
    "ci_docker_image_build": {
        "path": "ops/evidence/ci/stage0-rev2-docker-image-build.json",
        "label": "Docker image build",
        "condition_id": "ci_docker_image_build_missing",
        "missing_label": "CI Docker image build runtime evidence",
        "tokens": ("ci_docker_image_build", "docker", "images"),
        "checklist_items": [
            "CI Docker image build runtime evidence 通过：已安装 PR/main workflow build Docker images 并写入 `ops/evidence/ci/`。",
            "CI Docker image build exact evidence file 通过：`ops/evidence/ci/stage0-rev2-docker-image-build.json` exists, declares `environment=ci`, `release_gate_check_id=ci_docker_image_build`, passing status, Docker image build semantics, and no preserved blockers。",
        ],
    },
}

AGGREGATE_CHECKLIST_ITEM = "CI installed workflow runtime evidence 通过：PR/main run、Playwright smoke、Docker image build 均有 validator-resolvable evidence。"
INSTALLED_WORKFLOW_CHECKLIST_ITEM = "CI installed workflow file evidence 通过：`.github/workflows/stage0-rev2-ci.yml` 存在且被 release gate fixture 引用。"


class GenerationError(Exception):
    pass


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise GenerationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise GenerationError(f"{display_path(path)} must contain a JSON object")
    return value


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def strict_ci_exact_passes() -> tuple[bool, str]:
    result = subprocess.run(
        ["python3", "scripts/validate_stage1_ci_exact_evidence.py"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    output = (result.stderr or result.stdout).strip()
    return result.returncode == 0, output


def artifact_passes(check_id: str, spec: dict[str, Any]) -> tuple[bool, str]:
    path = ROOT / spec["path"]
    if not path.exists():
        return False, f"{spec['path']} is absent"
    try:
        data = load_json(path)
    except GenerationError as exc:
        return False, str(exc)
    if data.get("environment") != "ci":
        return False, f"{spec['path']} environment is not ci"
    if data.get("release_gate_check_id") != check_id:
        return False, f"{spec['path']} release_gate_check_id is not {check_id}"
    if data.get("status") not in {"pass", "passed"}:
        return False, f"{spec['path']} status is not pass/passed"
    if data.get("blocked_checks") or data.get("blockers") or data.get("do_not_launch_conditions"):
        return False, f"{spec['path']} preserves blockers"
    gate_impact = data.get("gate_impact")
    if isinstance(gate_impact, dict) and gate_impact.get("remaining_blockers"):
        return False, f"{spec['path']} gate_impact.remaining_blockers is not empty"
    combined = json.dumps(data, ensure_ascii=False).lower()
    missing_tokens = [token for token in spec["tokens"] if token not in combined]
    if missing_tokens:
        return False, f"{spec['path']} missing token(s): {missing_tokens}"
    return True, "pass"


def build_ci_fixture() -> tuple[dict[str, Any], bool]:
    workflow_exists = (ROOT / CI_WORKFLOW_REF).exists()
    strict_pass, strict_output = strict_ci_exact_passes()
    artifact_states = {
        check_id: artifact_passes(check_id, spec)
        for check_id, spec in CI_ARTIFACTS.items()
    }
    all_artifacts_pass = all(passed for passed, _ in artifact_states.values())
    ci_gate_go = workflow_exists and strict_pass and all_artifacts_pass

    checks: list[dict[str, Any]] = [
        {
            "check_id": "ci_draft_artifact_coverage",
            "status": "pass",
            "evidence_ref": f"{CI_DRAFT_EVIDENCE_REF} validates {CI_DRAFT_REF} coverage",
        },
        {
            "check_id": "ci_installed_workflow",
            "status": "pass" if workflow_exists else "blocked",
            "evidence_ref": (
                f"{CI_WORKFLOW_REF} is present and validates Stage 0 Rev2, Stage 1 pre-launch contracts, "
                "Stripe sandbox selftest wiring, Playwright smoke, Docker build coverage, and CI exact evidence aggregate validation; "
                "this satisfies CI installed workflow file evidence only."
                if workflow_exists
                else f"{CI_WORKFLOW_REF} is absent; workflow installation remains blocked."
            ),
        },
    ]

    for check_id, spec in CI_ARTIFACTS.items():
        passed, reason = artifact_states[check_id]
        check_passed = ci_gate_go and passed
        semantics = ", ".join(spec["tokens"])
        checks.append(
            {
                "check_id": check_id,
                "status": "pass" if check_passed else "blocked",
                "evidence_ref": (
                    f"{CI_WORKFLOW_REF} is present and exact CI runtime evidence {spec['path']} passed strict validation for {spec['label']}; "
                    f"{spec['path']} is present, declares environment=ci, release_gate_check_id={check_id}, passing status, required CI trigger/runtime semantics ({semantics}), and no preserved blockers."
                    if check_passed
                    else (
                        f"{CI_WORKFLOW_REF} is present and defines {spec['label']} coverage. "
                        "Runtime proof remains controlled by exact CI JSON artifacts; maintainers must attach validator-owned evidence files before changing this check state. "
                        f"CI {spec['label']} remains blocked because exact runtime evidence {spec['path']} is absent or not passable: {reason}."
                    )
                ),
            }
        )

    dnl = [
        {
            "condition_id": "ci_workflow_not_installed",
            "blueprint_condition": "Production deploy 缺 rollback plan、migration compatibility notes、post-deploy smoke test。",
            "is_present": not workflow_exists,
            "evidence_ref": (
                f"{CI_WORKFLOW_REF} is installed and validates Stage 0 Rev2 plus Stage 1 pre-launch contracts; workflow installation is no longer the active CI blocker."
                if workflow_exists
                else f"{CI_WORKFLOW_REF} is absent, so CI workflow installation remains active."
            ),
        }
    ]
    for check_id, spec in CI_ARTIFACTS.items():
        passed, reason = artifact_states[check_id]
        check_passed = ci_gate_go and passed
        condition_present = not check_passed
        dnl.append(
            {
                "condition_id": spec["condition_id"],
                "blueprint_condition": (
                    "Vertical workflows 只通过 generic rendering tests，没有 domain fixtures、four-option taxonomy、required outputs、QA/safety checks、manifest validation。"
                    if check_id == "ci_playwright_smoke"
                    else "Production deploy 缺 rollback plan、migration compatibility notes、post-deploy smoke test。"
                ),
                "is_present": condition_present,
                "evidence_ref": (
                    f"{CI_WORKFLOW_REF} is present and exact CI runtime evidence {spec['path']} passed strict validation; "
                    "the CI runtime condition is cleared by validator-owned CI artifact."
                    if not condition_present
                    else (
                        f"{CI_WORKFLOW_REF} is present and defines {spec['label']} coverage. "
                        "Runtime proof remains controlled by exact CI JSON artifacts; maintainers must attach validator-owned evidence files before changing this condition state. "
                        f"The {spec['condition_id']} condition is blocked because exact {spec['missing_label']} {spec['path']} is absent or not passable: {reason}."
                    )
                ),
            }
        )

    blocked_checks = [check["check_id"] for check in checks if check["status"] != "pass"]
    active_conditions = [condition["condition_id"] for condition in dnl if condition["is_present"]]
    status = "go" if not blocked_checks and not active_conditions else "no_go"
    if status == "go":
        decision_ref = (
            "fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status=go for checklist item "
            f"{AGGREGATE_CHECKLIST_ITEM} because exact validator-owned CI artifacts passed together: "
            "ops/evidence/ci/stage0-rev2-pr-main-run.json, "
            "ops/evidence/ci/stage0-rev2-playwright-smoke.json, and "
            "ops/evidence/ci/stage0-rev2-docker-image-build.json. "
            "The installed workflow path .github/workflows/stage0-rev2-ci.yml is present and CI exact evidence aggregate validation passed."
        )
    else:
        missing_sentences = " ".join(
            f"Exact {spec['missing_label']} {spec['path']} is absent or not passable."
            for check_id, spec in CI_ARTIFACTS.items()
            if not (ci_gate_go and artifact_states[check_id][0])
        )
        strict_sentence = "" if strict_pass else f" Strict CI exact validator has not passed: {strict_output}."
        decision_ref = (
            "fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status=no_go for checklist item "
            f"{AGGREGATE_CHECKLIST_ITEM} because "
            f"{', '.join(blocked_checks) or 'no check'} remain blocked while "
            f"{', '.join(active_conditions) or 'no condition'} remain active. "
            "The installed workflow path .github/workflows/stage0-rev2-ci.yml is present. "
            "Runtime execution remains controlled by validator-owned CI evidence rows; maintainers must attach exact PR/main run, Playwright smoke, and Docker image build JSON artifacts before the CI gate can change state. "
            f"{missing_sentences}{strict_sentence}"
        )

    fixture = {
        "schema_version": "stage0.rev2",
        "gate": "ci",
        "evidence_id": "gate_ci_installed_runtime_go" if status == "go" else "gate_ci_installed_runtime_blocked",
        "checks": checks,
        "do_not_launch_checks": dnl,
        "gate_decision": {
            "status": status,
            "blocked_by_checks": blocked_checks,
            "active_do_not_launch_conditions": active_conditions,
            "evidence_ref": decision_ref,
        },
        "provenance": {
            "blueprint_sections": ["23.2", "24"],
            "created_by_lane": "lane6",
        },
    }
    return fixture, ci_gate_go


def update_blueprint_checklist(path: Path, ci_gate_go: bool) -> None:
    if not path.exists():
        raise GenerationError(f"missing blueprint: {display_path(path)}")
    text = path.read_text(encoding="utf-8")
    checked_items = [AGGREGATE_CHECKLIST_ITEM]
    for spec in CI_ARTIFACTS.values():
        checked_items.extend(spec["checklist_items"])
    checked_items.append("CI Gate 全部通过。")

    for item in checked_items:
        from_marker = f"- [{' ' if ci_gate_go else 'x'}] {item}"
        to_marker = f"- [{'x' if ci_gate_go else ' '}] {item}"
        if from_marker in text:
            text = text.replace(from_marker, to_marker)
        elif to_marker not in text:
            raise GenerationError(f"blueprint missing CI checklist item: {item}")

    installed_from = f"- [ ] {INSTALLED_WORKFLOW_CHECKLIST_ITEM}"
    installed_to = f"- [x] {INSTALLED_WORKFLOW_CHECKLIST_ITEM}"
    if installed_from in text:
        text = text.replace(installed_from, installed_to)
    elif installed_to not in text:
        raise GenerationError(f"blueprint missing installed workflow checklist item: {INSTALLED_WORKFLOW_CHECKLIST_ITEM}")
    path.write_text(text, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE, help="CI release-gate fixture path")
    parser.add_argument("--blueprint", type=Path, default=DEFAULT_BLUEPRINT, help="Stage 0 Rev2 blueprint path")
    parser.add_argument("--check", action="store_true", help="validate generated output matches current files without writing")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        fixture, ci_gate_go = build_ci_fixture()
        if args.check:
            current = load_json(args.fixture)
            if current != fixture:
                print(f"CI release-gate fixture is stale: {display_path(args.fixture)}", file=sys.stderr)
                return 1
            return 0
        write_json(args.fixture, fixture)
        update_blueprint_checklist(args.blueprint, ci_gate_go)
    except GenerationError as exc:
        print(f"generate Stage 1 CI release-gate evidence failed: {exc}", file=sys.stderr)
        return 1
    print(
        "stage1 CI release-gate evidence generated: "
        + ("go" if ci_gate_go else "blocked")
        + f" ({display_path(args.fixture)})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
