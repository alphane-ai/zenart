#!/usr/bin/env python3
"""Render the current Stage 0 Rev2 no-go release notes from ops evidence."""

from __future__ import annotations

import argparse
import difflib
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs/stage0_blueprint_rev2.md"
OUTPUT_PATH = ROOT / "ops/release/stage0_rev2_current_no_go_release_notes.md"
PRIVATE_BETA_GATE = ROOT / "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json"
PRODUCTION_GATE = ROOT / "fixtures/stage0/rev2/release_gate_evidence.production_launch.json"
RUNTIME_SUMMARY = ROOT / "ops/evidence/stage0_runtime_drill_summary.json"
RUNTIME_CHECKLIST_GROUPS = {
    "Crawler governance runtime": [
        "crawler fetch/import 强制 source approval runtime gate。",
        "crawler runtime 强制 robots evidence。",
        "crawler runtime 强制 SSRF protections。",
        "crawler runtime 强制 source/global rate limits。",
        "crawler runtime 强制 raw content retention limit。",
        "crawler runtime 强制 exact-text import warning。",
        "crawler runtime 强制 provenance links。",
        "crawler runtime 强制 source blocklist。",
    ],
    "CI and staging runtime": [
        "添加 PR/main CI 到 `.github/workflows`。（token-blocked：当前 token 缺 workflow scope；draft/evidence 已落在 `ops/ci/` 和 `fixtures/ops/`。）",
        "CI 在已安装 PR/main workflow 中运行 Playwright smoke。",
        "CI 在已安装 PR/main workflow 中 build Docker images。",
        "执行 staging deploy。",
        "执行 staging smoke tests。",
    ],
    "Observability runtime": [
        "staging request id propagation runtime evidence 通过。",
        "staging structured JSON logs runtime evidence 通过。",
        "staging OpenTelemetry traces runtime evidence 通过。",
        "staging backend/worker/crawler metrics runtime evidence 通过。",
        "导入并验证 staging dashboards runtime evidence。",
        "配置并验证 staging alert routes/runtime evidence。",
    ],
    "Release gate runtime": [
        "Local Alpha Gate 全部通过。",
        "CI Gate 全部通过。",
        "Private Beta/Staging Gate 全部通过。",
        "Production Launch Gate 全部通过。",
        "Do-Not-Launch Conditions 全部为 false。",
        "Local Alpha workflow API/Playwright end-to-end smoke evidence 通过并写入 release gate fixture。",
        "CI installed workflow runtime evidence 通过：PR/main run、Playwright smoke、Docker image build 均有 validator-resolvable evidence。",
        "Private Beta/Staging external-user runtime evidence 通过：auth/RBAC/tenant、storage、quota/rate limit、support/abuse、safety/QA/crawler、observability/backup/load、legal visibility 均有 staging evidence。",
        "Production Launch runtime/deployment evidence 通过：provider-or-comp-only、paid lifecycle、skill canary、activation audit、abuse hold、security、backup/rollback/post-deploy smoke、legal/support policy 均有 production evidence。",
        "Staging post-deploy smoke tests 通过。",
        "Production post-deploy smoke tests 通过。",
    ],
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def backtick(value: str) -> str:
    return f"`{value}`"


def gate_blockers(gate: dict) -> list[str]:
    blockers: list[str] = []
    for check in gate.get("checks", []):
        if check.get("status") not in {"pass", "passed"}:
            blockers.append(str(check.get("check_id", "unknown_check")))
    return blockers


def present_do_not_launch(gate: dict) -> list[str]:
    return [
        str(check.get("condition_id", "unknown_condition"))
        for check in gate.get("do_not_launch_checks", [])
        if check.get("is_present") is True
    ]


def comma_or_missing(values: list[str]) -> str:
    return ", ".join(values) if values else "none recorded"


def unchecked_blueprint_items() -> set[str]:
    unchecked: set[str] = set()
    for line in BLUEPRINT.read_text(encoding="utf-8").splitlines():
        if line.startswith("- [ ] "):
            unchecked.add(line.removeprefix("- [ ] ").strip())
    return unchecked


def runtime_checklist_lines() -> list[str]:
    unchecked = unchecked_blueprint_items()
    rows: list[str] = []
    for group, items in RUNTIME_CHECKLIST_GROUPS.items():
        open_items = [item.rstrip("。.") for item in items if item in unchecked]
        if open_items:
            rows.append(f"- {group}: {'; '.join(open_items)}.")
    return rows or ["- No tracked runtime checklist rows are open; verify gate fixtures before changing release status."]


def local_status(summary: dict, section: str, default: str = "missing") -> str:
    value = summary.get(section)
    if isinstance(value, dict):
        return str(value.get("status", default))
    return default


def local_report(summary: dict, section: str, default: str = "missing") -> str:
    value = summary.get(section)
    if isinstance(value, dict):
        return str(value.get("source_report", default))
    return default


def load_smoke_summary(summary: dict) -> str:
    rows = summary.get("load_smoke", [])
    if not isinstance(rows, list) or not rows:
        return "missing"
    passed = sum(1 for row in rows if row.get("status") == "passed")
    total = len(rows)
    reports = [str(row.get("report_path")) for row in rows if row.get("report_path")]
    first_report = reports[0] if reports else "missing"
    return f"local {passed}/{total} modes passed; first report {first_report}"


def render(release_sha: str, release_tag: str, owner: str, reviewer: str, date: str) -> str:
    private_beta = load_json(PRIVATE_BETA_GATE)
    production = load_json(PRODUCTION_GATE)
    runtime = load_json(RUNTIME_SUMMARY)

    private_beta_blockers = gate_blockers(private_beta)
    private_beta_dnl = present_do_not_launch(private_beta)
    production_blockers = gate_blockers(production)
    production_dnl = present_do_not_launch(production)

    release_sha_text = release_sha or "not selected; set RELEASE_SHA for a deploy candidate"
    release_tag_text = release_tag or "n/a"
    owner_text = owner or "lane5"
    reviewer_text = reviewer or "pending"
    date_text = date or "2026-05-27"

    backup_report = local_report(runtime, "backup_restore")
    observability_report = local_report(runtime, "observability_smoke")
    security_report = local_report(runtime, "security_scan_smoke")

    lines = [
        "# Stage 0 Rev2 Current No-Go Release Notes",
        "",
        "Authoritative source: `Docs/stage0_blueprint_rev2.md`.",
        "",
        "Release gate status: `no-go`.",
        "",
        "## Identity",
        "",
        f"- Release SHA: {backtick(release_sha_text)}",
        f"- Release tag: {backtick(release_tag_text)}",
        f"- Owner: {backtick(owner_text)}",
        f"- Reviewer: {backtick(reviewer_text)}",
        "- Environment: `local`",
        f"- Date: {backtick(date_text)}",
        "",
        "## Scope",
        "",
        "- User-facing changes: `n/a`",
        "- Admin/operator changes: `n/a`",
        "- Backend/worker/crawler changes: `n/a`",
        "- Ops/config changes: current Stage 0 Rev2 ops evidence snapshot for observability, restore/load drill summary, staging/post-deploy smoke contract, and release gate no-go decision.",
        "",
        "## Migration List",
        "",
        "- Migration files: `n/a`",
        "- Expand/contract compatibility notes: `blocked: no staging migration evidence attached`",
        "- Worker schema compatibility notes: `blocked: no staging worker compatibility evidence attached`",
        "- Rollback constraints: `forward repair required for any future DB migration; no destructive rollback evidence attached`",
        "",
        "## Config Diff",
        "",
        "- Environment variables added: `n/a`",
        "- Environment variables changed: `n/a`",
        "- Secret source changes: `n/a`",
        "- Object storage changes: local restore drill evidence only; staging bucket policy/signing/versioning evidence remains required.",
        "- Provider/model routing changes: `n/a`",
        "",
        "## Feature Flags",
        "",
        "- Enabled: `n/a`",
        "- Disabled: `n/a`",
        "- Emergency rollback flags: `n/a; staging rollback values must be named before deploy`",
        "",
        "## Smoke Plan",
        "",
        "- Backend health/readiness: `scripts/staging_smoke.sh`, evidence required for staging/private beta.",
        "- Web smoke: `scripts/playwright_smoke.sh` or staging smoke web checks, evidence required for CI/staging/private beta.",
        "- Admin smoke: `scripts/playwright_smoke.sh` or staging smoke admin checks, evidence required for CI/staging/private beta.",
        "- Export/package smoke: `scripts/staging_smoke.sh` export/package checks with seeded records, evidence required.",
        "- Signed download smoke: `scripts/staging_smoke.sh` signed download check with seeded export, evidence required.",
        "- Worker/crawler smoke: `scripts/staging_smoke.sh` worker task and crawler admin checks, evidence required.",
        "- Quota/rate-limit smoke: `scripts/staging_smoke.sh` quota/rate-limit check, evidence required.",
        "",
        "## Evidence",
        "",
        "- CI run: `missing`; required for CI/private beta/production decisions.",
        "- Docker image build: `missing`; required for CI/private beta/production decisions.",
        "- Playwright smoke: `missing`; required before CI gate can close.",
        "- Migration run: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=migration`, and record status `passed` or `compatible` before private beta/production decisions.",
        "- Staging smoke: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=post_deploy_smoke`, record status `passed`, verify backend health/readiness, web, admin, auth boundary, worker task, export/package, signed download, crawler admin, quota/rate-limit, request-id observability categories, and include seeded user, tenant, task, package, and export smoke IDs.",
        f"- Load smoke: {load_smoke_summary(runtime)}; staging evidence required before private beta/production decisions.",
        "- Config diff: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=config_diff`, and record status `passed`, `reviewed`, or `no_diff` before private beta/production decisions.",
        f"- Observability smoke: local status `{local_status(runtime, 'observability_smoke')}` from `{observability_report}`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=observability`, record status `passed`, and include passed/validated evidence refs for request-id propagation, structured JSON logs, OpenTelemetry traces, backend/worker/crawler metrics, dashboard import, and alert routes.",
        f"- Backup/restore drill: local status `{local_status(runtime, 'backup_restore')}` from `{backup_report}`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=backup_restore`, record status `passed`, and include passed/validated evidence refs for Postgres restore and exported package/object restore before private beta/production decisions.",
        "- Load evidence: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=load`, record status `passed`, and include passed/validated evidence refs for `chat_task`, `worker_generation`, `zip_export`, `signed_download`, `crawler_throttle`, `quota_contention`, and `workspace_rendering` before private beta/production decisions.",
        "- Rollback drill: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=rollback`, record status `passed` or `validated`, and include passed/validated evidence refs for image rollback, feature flag rollback, migration compatibility, worker drain, and post-rollback smoke.",
        f"- Security scan: local status `{local_status(runtime, 'security_scan_smoke')}` from `{security_report}`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=security_scan`, record status `passed`, and include passed/validated evidence refs for dependency, image/container, and committed-secret scans before private beta/production decisions.",
        "",
        "## Rollback Plan",
        "",
        "- Previous SHA: `pending`",
        "- Image rollback command: `pending; requires SHA-tagged image refs`",
        "- Feature flag rollback: `pending; requires exact staging flag values`",
        "- Migration repair plan: `forward repair only; no destructive DB rollback`",
        "- Worker drain plan: `pending; must be set before migration deploy`",
        "- Owner and escalation: `pending release owner and severity policy`",
        "",
        "## Known Risks",
        "",
        f"- Open private beta blockers: `{PRIVATE_BETA_GATE.relative_to(ROOT)}`: {comma_or_missing(private_beta_blockers)}.",
        f"- Private beta do-not-launch conditions present: {comma_or_missing(private_beta_dnl)}.",
        f"- Open production blockers: `{PRODUCTION_GATE.relative_to(ROOT)}`: {comma_or_missing(production_blockers)}.",
        f"- Production do-not-launch conditions present: {comma_or_missing(production_dnl)}.",
        "- Operational risks: staging observability, restore, rollback, load, and post-deploy smoke evidence are absent.",
        "- User/support risks: external-user legal/support pages and support readiness remain blocked by Rev2 gate evidence.",
        "",
        "## Open Rev2 Runtime Checklist",
        "",
        *runtime_checklist_lines(),
        "",
        "## Go/No-Go",
        "",
        "- Decision: `no-go`",
        "- Approver: `pending`",
        "- Conditions: CI, staging smoke, observability runtime evidence, restore/rollback evidence, security scans, release owner, and gate fixture blockers must be cleared before any private beta or production decision.",
        "- Follow-up deadline: `n/a`",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if the checked-in notes are stale")
    parser.add_argument("--write", action="store_true", help="write the checked-in current no-go notes")
    parser.add_argument("--output", default=str(OUTPUT_PATH), help="output path for --write")
    parser.add_argument("--release-sha", default=os.environ.get("RELEASE_SHA", ""))
    parser.add_argument("--release-tag", default=os.environ.get("RELEASE_TAG", ""))
    parser.add_argument("--owner", default=os.environ.get("RELEASE_OWNER", "lane5"))
    parser.add_argument("--reviewer", default=os.environ.get("RELEASE_REVIEWER", "pending"))
    parser.add_argument("--date", default=os.environ.get("RELEASE_NOTES_DATE", "2026-05-27"))
    args = parser.parse_args()

    rendered = render(
        release_sha=args.release_sha,
        release_tag=args.release_tag,
        owner=args.owner,
        reviewer=args.reviewer,
        date=args.date,
    )

    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = ROOT / output_path

    if args.check:
        existing = output_path.read_text(encoding="utf-8")
        if existing != rendered:
            diff = difflib.unified_diff(
                existing.splitlines(keepends=True),
                rendered.splitlines(keepends=True),
                fromfile=str(output_path.relative_to(ROOT)),
                tofile="rendered",
            )
            print("".join(diff), end="")
            raise SystemExit("current no-go release notes are stale; run scripts/render_no_go_release_notes.py --write")
        return 0

    if args.write:
        output_path.write_text(rendered, encoding="utf-8")
        return 0

    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
