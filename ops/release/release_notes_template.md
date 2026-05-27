# Stage 0 Rev2 Release Notes

Authoritative source: `Docs/stage0_blueprint_rev2.md`.

Release gate status: `no-go` until every required evidence slot below is filled and approved.

## Identity

- Release SHA: `<git-sha>`
- Release tag: `<release-tag-or-n/a>`
- Owner: `<release-owner>`
- Reviewer: `<reviewer>`
- Environment: `local | ci | staging | production`
- Date: `<YYYY-MM-DD>`

## Scope

- User-facing changes: `<summary or n/a>`
- Admin/operator changes: `<summary or n/a>`
- Backend/worker/crawler changes: `<summary or n/a>`
- Ops/config changes: `<summary or n/a>`

## Migration List

- Migration files: `<list migration IDs or n/a>`
- Expand/contract compatibility notes: `<compatible | blocked: reason>`
- Worker schema compatibility notes: `<compatible | blocked: reason>`
- Rollback constraints: `<forward repair required | no DB rollback | n/a>`

## Config Diff

- Environment variables added: `<names or n/a>`
- Environment variables changed: `<names or n/a>`
- Secret source changes: `<source/ref or n/a>`
- Object storage changes: `<bucket/policy/signing/versioning diff or n/a>`
- Provider/model routing changes: `<diff or n/a>`

## Feature Flags

- Enabled: `<flags>`
- Disabled: `<flags>`
- Emergency rollback flags: `<flags and exact rollback values>`

## Smoke Plan

- Backend health/readiness: `scripts/staging_smoke.sh` or local equivalent, evidence `<path/url>`
- Web smoke: `scripts/playwright_smoke.sh` or manual browser smoke, evidence `<path/url>`
- Admin smoke: `scripts/playwright_smoke.sh` or manual browser smoke, evidence `<path/url>`
- Export/package smoke: `<command and evidence>`
- Signed download smoke: `<command and evidence>`
- Worker/crawler smoke: `<command and evidence>`
- Quota/rate-limit smoke: `<command and evidence>`

## Evidence

- CI run: `<run url>`; required for CI/private beta/production decisions.
- Docker image build: `<image refs>`; required for CI/private beta/production decisions.
- Playwright smoke: `<report path/url>`; required before CI gate can close.
- Migration run: `<local JSON path/url>`; local JSON must reference the release SHA, set `environment=staging`, set `kind=migration`, and record status `passed` or `compatible` before staging/private beta decisions.
- Staging smoke: `<local JSON path/url>`; required before private beta/production decisions. Local JSON must reference the release SHA, set `environment=staging`, set `kind=post_deploy_smoke`, record status `passed`, prove backend health/readiness, web, admin, auth boundary, worker task, export/package, signed download, crawler admin, quota/rate-limit, and request-id observability categories, and include seeded user, tenant, task, package, and export smoke IDs.
- Load smoke run: `<report path/url>`; required before private beta/production decisions.
- Config diff: `<local JSON path/url>`; local JSON must reference the release SHA, set `environment=staging`, set `kind=config_diff`, and record status `passed`, `reviewed`, or `no_diff`.
- Observability: `<local JSON path/url>`; local JSON must reference the release SHA, set `environment=staging`, set `kind=observability`, record status `passed`, and include passed/validated entries with evidence refs for request-id propagation, structured JSON logs, OpenTelemetry traces, backend/worker/crawler metrics, dashboard import, and alert routes.
- Backup/restore drill: local evidence `ops/evidence/backup-restore/local/20260526T153126Z/report.json`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=backup_restore`, and record status `passed`; production evidence remains required before production can close.
- Load evidence: `<local JSON path/url>`; local JSON must reference the release SHA, set `environment=staging`, set `kind=load`, record status `passed`, and include passed/validated entries with evidence refs for `chat_task`, `worker_generation`, `zip_export`, `signed_download`, `crawler_throttle`, `quota_contention`, and `workspace_rendering` before private beta/production decisions.
- Object-storage signed URL evidence: `<ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json or newer>`; staging JSON must set `environment=staging`, target `release_gate_check_id=staging_object_storage_signed_downloads`, prove tenant-scoped signed download, expiry denial, direct-object denial, and cross-tenant denial, and preserve retention/cleanup blockers unless the split retention evidence below is also attached.
- Object-storage retention cleanup evidence: `<ops/evidence/staging/object-storage-retention-cleanup.json>`; staging JSON must set `environment=staging`, target `release_gate_check_id=staging_object_storage_signed_downloads`, record status `pass` or `passed`, and prove retention policy, expired export cleanup, orphan cleanup, and audit refs before the object-storage gate can close.
- Legal/support external-user visibility evidence: `<ops/evidence/staging/legal-pages-external-user.json and ops/evidence/staging/support-contact-external-user.json>`; staging JSON must set `environment=staging`, target `release_gate_check_id=staging_legal_external_user_pages`, record status `pass` or `passed`, and prove Terms, Privacy, Acceptable Use, AI/content disclaimer, IP complaint flow, visible support contact, report-problem path, and billing/support policy visibility from deployed staging routes rather than source files.
- Rollback drill: `<local JSON path/url>`; local JSON must reference the release SHA, set `environment=staging`, set `kind=rollback`, record status `passed` or `validated`, and include passed/validated entries with evidence refs for image rollback, feature flag rollback, migration compatibility, worker drain, and post-rollback smoke.
- Security scan: `<local JSON path/url>`; local JSON must reference the release SHA, set `environment=staging`, set `kind=security_scan`, record status `passed`, and include passed/validated entries with evidence refs for dependency, image/container, and committed-secret scans before private beta/production decisions.

## Rollback Plan

- Previous SHA: `<sha>`
- Image rollback command: `<exact command>`
- Feature flag rollback: `<exact flag values>`
- Migration repair plan: `<forward repair plan or n/a>`
- Worker drain plan: `<exact command/procedure>`
- Owner and escalation: `<owner, channel, severity policy>`

## Known Risks

- Open private beta blockers: `<list from fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json>`
- Open production do-not-launch conditions: `<list from fixtures/stage0/rev2/release_gate_evidence.production_launch.json>`
- Operational risks: `<observability/backup/rollback/support risks>`
- User/support risks: `<customer impact and support readiness risks>`

## Go/No-Go

- Decision: `no-go` unless CI, staging, smoke, observability, restore, rollback, security, and release owner evidence are attached.
- Approver: `<name>`
- Conditions: `<explicit go/no-go conditions>`
- Follow-up deadline: `<YYYY-MM-DD or n/a>`
