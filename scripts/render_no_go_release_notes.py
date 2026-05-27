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
STAGING_OBSERVABILITY_RUNTIME = ROOT / "ops/evidence/staging/20260527T1830Z-observability-runtime.json"
STAGING_OBSERVABILITY_BACKUP_LOAD_PREFLIGHT = (
    ROOT / "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json"
)
STAGING_BACKUP_RESTORE = ROOT / "ops/evidence/staging/20260527T2115Z-backup-restore.json"
STAGING_LOAD = ROOT / "ops/evidence/staging/20260527T2120Z-load.json"
STAGING_POST_DEPLOY_SMOKE = ROOT / "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json"
STAGING_LEGAL_EXTERNAL_PAGES = ROOT / "ops/evidence/staging/legal-pages-external-user.json"
STAGING_SUPPORT_CONTACT_VISIBILITY = ROOT / "ops/evidence/staging/support-contact-external-user.json"
STAGING_OBJECT_RETENTION_BLOCKED = ROOT / "ops/evidence/staging/object-storage-retention-cleanup.blocked.json"
CURRENT_RELEASE_EVIDENCE_BUNDLE = (
    ROOT / "ops/evidence/release/staging/stage0-rev2-current-release-evidence-bundle.json"
)
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
        "Private Beta/Staging object storage signed download/retention runtime evidence 通过。",
        "Private Beta/Staging object retention/cleanup runtime evidence 通过：staging evidence proves retention policy, expired export cleanup, orphan cleanup, and audit refs under `ops/evidence/staging/`。",
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
            rows.append(
                f"- {group} open target rows: {'; '.join(open_items)}. "
                "These are blueprint checklist labels that remain unchecked, not satisfied release evidence."
            )
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


def staging_observability_summary() -> str:
    if not STAGING_OBSERVABILITY_RUNTIME.exists():
        return "missing"
    evidence = load_json(STAGING_OBSERVABILITY_RUNTIME)
    status = evidence.get("status", "missing")
    signals = evidence.get("signals", [])
    passed = sum(1 for signal in signals if signal.get("status") in {"passed", "validated"})
    total = len(signals)
    path = STAGING_OBSERVABILITY_RUNTIME.relative_to(ROOT)
    return f"staging status `{status}` from `{path}` with {passed}/{total} required signals validator-visible"


def staging_combined_preflight_summary() -> str:
    if not STAGING_OBSERVABILITY_BACKUP_LOAD_PREFLIGHT.exists():
        return "combined preflight `missing`"
    evidence = load_json(STAGING_OBSERVABILITY_BACKUP_LOAD_PREFLIGHT)
    status = evidence.get("status", "missing")
    path = STAGING_OBSERVABILITY_BACKUP_LOAD_PREFLIGHT.relative_to(ROOT)
    checks = evidence.get("checks", [])
    verified = sum(1 for check in checks if check.get("verified") is True)
    total = len(checks)
    release_sha = evidence.get("release_sha", "missing release SHA")
    return f"combined preflight `{status}` from `{path}` for release `{release_sha}` with {verified}/{total} slots verified"


def staging_backup_restore_summary() -> str:
    if not STAGING_BACKUP_RESTORE.exists():
        return "missing"
    evidence = load_json(STAGING_BACKUP_RESTORE)
    drills = evidence.get("drills", [])
    passed = sum(1 for drill in drills if drill.get("status") in {"passed", "validated"})
    total = len(drills)
    path = STAGING_BACKUP_RESTORE.relative_to(ROOT)
    return f"staging status `{evidence.get('status', 'missing')}` from `{path}` with {passed}/{total} restore drills passed"


def staging_load_summary() -> str:
    if not STAGING_LOAD.exists():
        return "missing"
    evidence = load_json(STAGING_LOAD)
    modes = evidence.get("modes", [])
    passed = sum(1 for mode in modes if mode.get("status") in {"passed", "validated"})
    total = len(modes)
    path = STAGING_LOAD.relative_to(ROOT)
    return f"staging status `{evidence.get('status', 'missing')}` from `{path}` with {passed}/{total} load modes passed"


def staging_post_deploy_smoke_summary() -> str:
    if not STAGING_POST_DEPLOY_SMOKE.exists():
        return "missing"
    evidence = load_json(STAGING_POST_DEPLOY_SMOKE)
    steps = evidence.get("steps", [])
    passed = sum(1 for step in steps if step.get("status") in {"passed", "validated"})
    total = len(steps)
    path = STAGING_POST_DEPLOY_SMOKE.relative_to(ROOT)
    return f"staging status `{evidence.get('status', 'missing')}` from `{path}` with {passed}/{total} smoke categories passed"


def staging_object_storage_signed_url_summary() -> str:
    path = ROOT / "ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json"
    if not path.exists():
        return "missing"
    evidence = load_json(path)
    status = evidence.get("status", "missing")
    coverage = evidence.get("coverage", [])
    passed = sum(1 for item in coverage if item.get("status") == "pass")
    total = len(coverage)
    return (
        f"staging status `{status}` from `{path.relative_to(ROOT)}` with {passed}/{total} signed URL probes "
        "validator-visible; retention/cleanup evidence still required"
    )


def staging_object_storage_retention_cleanup_summary() -> str:
    path = ROOT / "ops/evidence/staging/object-storage-retention-cleanup.json"
    if not path.exists():
        if STAGING_OBJECT_RETENTION_BLOCKED.exists():
            evidence = load_json(STAGING_OBJECT_RETENTION_BLOCKED)
            blocked_checks = evidence.get("blocked_checks", [])
            blocked_count = len(blocked_checks) if isinstance(blocked_checks, list) else 0
            reason = "missing staging base URL or explicit probe URLs"
            if blocked_checks and all(
                isinstance(item, str) and "missing_staging_base_url_or_explicit_probe_urls" in item
                for item in blocked_checks
            ):
                reason = "missing STAGING_BASE_URL or explicit retention/audit probe URLs"
            return (
                f"`blocked` from `{STAGING_OBJECT_RETENTION_BLOCKED.relative_to(ROOT)}` with "
                f"{blocked_count}/4 probes blocked by {reason}; canonical pass evidence is still missing at "
                "`ops/evidence/staging/object-storage-retention-cleanup.json`, so the object-storage gate remains open"
            )
        return (
            "`missing`; run `scripts/staging_object_storage_retention_cleanup_smoke.sh` against staging and "
            "write `ops/evidence/staging/object-storage-retention-cleanup.json` proving retention policy, "
            "expired export cleanup, orphan cleanup, and audit refs before the object-storage gate can close"
        )
    evidence = load_json(path)
    status = evidence.get("status", "missing")
    coverage = evidence.get("coverage", [])
    passed = sum(1 for item in coverage if item.get("status") == "pass")
    total = len(coverage)
    return f"staging status `{status}` from `{path.relative_to(ROOT)}` with {passed}/{total} retention/cleanup probes validator-visible"


def staging_legal_support_visibility_summary() -> str:
    missing_paths = [
        str(path.relative_to(ROOT))
        for path in (STAGING_LEGAL_EXTERNAL_PAGES, STAGING_SUPPORT_CONTACT_VISIBILITY)
        if not path.exists()
    ]
    if missing_paths:
        return (
            "`missing`; run `scripts/staging_legal_support_visibility_smoke.sh` against staging and write "
            "`ops/evidence/staging/legal-pages-external-user.json` plus "
            "`ops/evidence/staging/support-contact-external-user.json` proving Terms, Privacy, Acceptable Use, "
            "AI/content disclaimer, IP complaint flow, visible support contact, report-problem path, and billing/support "
            "policy visibility before the legal/support gate can close"
        )

    legal = load_json(STAGING_LEGAL_EXTERNAL_PAGES)
    support = load_json(STAGING_SUPPORT_CONTACT_VISIBILITY)
    statuses = [legal.get("status", "missing"), support.get("status", "missing")]
    refs = [
        str(STAGING_LEGAL_EXTERNAL_PAGES.relative_to(ROOT)),
        str(STAGING_SUPPORT_CONTACT_VISIBILITY.relative_to(ROOT)),
    ]
    return (
        f"staging split status `{','.join(statuses)}` from `{refs[0]}` and `{refs[1]}`; "
        "external-user legal/support visibility is validator-visible"
    )


def release_evidence_bundle_summary() -> str:
    if not CURRENT_RELEASE_EVIDENCE_BUNDLE.exists():
        return (
            "`missing`; run `DRY_RUN=1 RUN_ID=stage0-rev2-current-release-evidence-bundle "
            "OUT_DIR=ops/evidence/release/staging scripts/release_evidence_bundle_smoke.sh` to write the "
            "current no-go release bundle without clearing any runtime gate"
        )
    evidence = load_json(CURRENT_RELEASE_EVIDENCE_BUNDLE)
    blockers = evidence.get("blocking_reason_count", len(evidence.get("blocking_reasons", [])))
    source = evidence.get("legal_support_evidence_source", "missing")
    path = CURRENT_RELEASE_EVIDENCE_BUNDLE.relative_to(ROOT)
    return (
        f"`{evidence.get('status', 'missing')}` / `{evidence.get('decision', 'missing')}` from `{path}` "
        f"with {blockers} blocking reasons; legal/support source `{source}`; object-retention cleanup "
        "remains unverified and canonical pass evidence is still required"
    )


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
        "- Object storage changes: staging signed URL evidence is attached; staging retention/cleanup pass evidence remains required before the object-storage gate can close.",
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
        f"- Staging smoke: {staging_post_deploy_smoke_summary()}; staging post-deploy smoke is validator-visible through {staging_combined_preflight_summary()}, but the private beta gate remains `no-go` while object retention/cleanup remains blocked.",
        f"- Load smoke: {load_smoke_summary(runtime)}; staging load evidence is attached in the release evidence line below.",
        "- Config diff: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=config_diff`, and record status `passed`, `reviewed`, or `no_diff` before private beta/production decisions.",
        f"- Observability smoke: local status `{local_status(runtime, 'observability_smoke')}` from `{observability_report}`; {staging_observability_summary()}; {staging_combined_preflight_summary()}.",
        f"- Backup/restore drill: local status `{local_status(runtime, 'backup_restore')}` from `{backup_report}`; {staging_backup_restore_summary()}; production backup/restore evidence remains separate and required before production decisions.",
        f"- Load evidence: {staging_load_summary()}; production load evidence remains separate and required before production decisions.",
        f"- Object-storage signed URL: {staging_object_storage_signed_url_summary()}; object retention policy, expired export cleanup, orphan cleanup, and audit refs remain required before the object-storage gate can close.",
        f"- Object-storage retention cleanup: {staging_object_storage_retention_cleanup_summary()}.",
        f"- Legal/support external-user visibility: {staging_legal_support_visibility_summary()}.",
        f"- Release evidence bundle: {release_evidence_bundle_summary()}.",
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
        "- Operational risks: staging rollback evidence remains absent; staging backup/restore, load, post-deploy smoke, and legal/support visibility evidence are attached, but object-retention, CI, and production gates remain open.",
        "- Object-storage risks: signed URL staging evidence is attached, but retention/cleanup runtime evidence still blocks the object-storage release gate.",
        "- User/support risks: external-user legal/support pages and report-problem visibility are validated for staging; production legal/support policy remains separately gated.",
        "",
        "## Open Rev2 Runtime Checklist",
        "",
        *runtime_checklist_lines(),
        "",
        "## Go/No-Go",
        "",
        "- Decision: `no-go`",
        "- Approver: `pending`",
        "- Conditions: CI installed workflow evidence, object retention cleanup evidence, staging migration/config/rollback/security evidence, production deployment evidence, release owner, and gate fixture blockers must be cleared before any private beta or production decision.",
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
