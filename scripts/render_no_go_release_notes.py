#!/usr/bin/env python3
"""Render the current Stage 0 Rev2 no-go release notes from ops evidence."""

from __future__ import annotations

import argparse
import difflib
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "ops/release/stage0_rev2_current_no_go_release_notes.md"
PRIVATE_BETA_GATE = ROOT / "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json"
PRODUCTION_GATE = ROOT / "fixtures/stage0/rev2/release_gate_evidence.production_launch.json"
RUNTIME_SUMMARY = ROOT / "ops/evidence/stage0_runtime_drill_summary.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def backtick(value: str) -> str:
    return f"`{value}`"


def gate_blockers(gate: dict) -> list[str]:
    blockers: list[str] = []
    for check in gate.get("checks", []):
        if check.get("status") != "passed":
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
        "- Migration run: `missing`; required before staging/production decisions.",
        "- Staging smoke: `missing`; required before private beta/production decisions.",
        f"- Load smoke: {load_smoke_summary(runtime)}; staging evidence required before private beta/production decisions.",
        f"- Observability smoke: local status `{local_status(runtime, 'observability_smoke')}` from `{observability_report}`; staging logs, metrics, traces, dashboard import, and alert-route evidence required.",
        f"- Backup/restore drill: local status `{local_status(runtime, 'backup_restore')}` from `{backup_report}`; staging/production restore evidence required before those gates can close.",
        f"- Security scan: local status `{local_status(runtime, 'security_scan_smoke')}` from `{security_report}`; CI/staging release-context scan evidence required.",
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
