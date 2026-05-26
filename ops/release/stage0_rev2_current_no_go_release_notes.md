# Stage 0 Rev2 Current No-Go Release Notes

Authoritative source: `Docs/stage0_blueprint_rev2.md`.

Release gate status: `no-go`.

## Identity

- Release SHA: `not selected; set RELEASE_SHA for a deploy candidate`
- Release tag: `n/a`
- Owner: `lane5`
- Reviewer: `pending`
- Environment: `local`
- Date: `2026-05-27`

## Scope

- User-facing changes: `n/a`
- Admin/operator changes: `n/a`
- Backend/worker/crawler changes: `n/a`
- Ops/config changes: current Stage 0 Rev2 ops evidence snapshot for observability, restore/load drill summary, staging/post-deploy smoke contract, and release gate no-go decision.

## Migration List

- Migration files: `n/a`
- Expand/contract compatibility notes: `blocked: no staging migration evidence attached`
- Worker schema compatibility notes: `blocked: no staging worker compatibility evidence attached`
- Rollback constraints: `forward repair required for any future DB migration; no destructive rollback evidence attached`

## Config Diff

- Environment variables added: `n/a`
- Environment variables changed: `n/a`
- Secret source changes: `n/a`
- Object storage changes: local restore drill evidence only; staging bucket policy/signing/versioning evidence remains required.
- Provider/model routing changes: `n/a`

## Feature Flags

- Enabled: `n/a`
- Disabled: `n/a`
- Emergency rollback flags: `n/a; staging rollback values must be named before deploy`

## Smoke Plan

- Backend health/readiness: `scripts/staging_smoke.sh`, evidence required for staging/private beta.
- Web smoke: `scripts/playwright_smoke.sh` or staging smoke web checks, evidence required for CI/staging/private beta.
- Admin smoke: `scripts/playwright_smoke.sh` or staging smoke admin checks, evidence required for CI/staging/private beta.
- Export/package smoke: `scripts/staging_smoke.sh` export/package checks with seeded records, evidence required.
- Signed download smoke: `scripts/staging_smoke.sh` signed download check with seeded export, evidence required.
- Worker/crawler smoke: `scripts/staging_smoke.sh` worker task and crawler admin checks, evidence required.
- Quota/rate-limit smoke: `scripts/staging_smoke.sh` quota/rate-limit check, evidence required.

## Evidence

- CI run: `missing`; required for CI/private beta/production decisions.
- Docker image build: `missing`; required for CI/private beta/production decisions.
- Playwright smoke: `missing`; required before CI gate can close.
- Migration run: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=migration`, and record status `passed` or `compatible` before private beta/production decisions.
- Staging smoke: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=post_deploy_smoke`, record status `passed`, verify backend health/readiness, web, admin, auth boundary, worker task, export/package, signed download, crawler admin, quota/rate-limit, request-id observability categories, and include seeded user, tenant, task, package, and export smoke IDs.
- Load smoke: local 7/7 modes passed; first report ops/evidence/load/local/20260526T142030Z-chat_task-64820.json; staging evidence required before private beta/production decisions.
- Config diff: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=config_diff`, and record status `passed`, `reviewed`, or `no_diff` before private beta/production decisions.
- Observability smoke: local status `passed` from `ops/evidence/observability/local/20260526T192311Z-observability-smoke-7780.json`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=observability`, record status `passed`, and include passed/validated evidence refs for request-id propagation, structured JSON logs, OpenTelemetry traces, backend/worker/crawler metrics, dashboard import, and alert routes.
- Backup/restore drill: local status `passed` from `ops/evidence/backup-restore/local/20260526T153126Z/report.json`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=backup_restore`, record status `passed`, and include passed/validated evidence refs for Postgres restore and exported package/object restore before private beta/production decisions.
- Load evidence: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=load`, record status `passed`, and include passed/validated evidence refs for `chat_task`, `worker_generation`, `zip_export`, `signed_download`, `crawler_throttle`, `quota_contention`, and `workspace_rendering` before private beta/production decisions.
- Rollback drill: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=rollback`, record status `passed` or `validated`, and include passed/validated evidence refs for image rollback, feature flag rollback, migration compatibility, worker drain, and post-rollback smoke.
- Security scan: local status `passed` from `ops/evidence/security/local/20260526T142040Z-security-scan-smoke-65314.json`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=security_scan`, record status `passed`, and include passed/validated evidence refs for dependency, image/container, and committed-secret scans before private beta/production decisions.

## Rollback Plan

- Previous SHA: `pending`
- Image rollback command: `pending; requires SHA-tagged image refs`
- Feature flag rollback: `pending; requires exact staging flag values`
- Migration repair plan: `forward repair only; no destructive DB rollback`
- Worker drain plan: `pending; must be set before migration deploy`
- Owner and escalation: `pending release owner and severity policy`

## Known Risks

- Open private beta blockers: `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json`: staging_object_storage_signed_downloads, staging_quota_rate_limit_spend_cap, staging_eval_qa_safety_runtime, staging_observability_backup_load, staging_legal_external_user_pages.
- Private beta do-not-launch conditions present: rate_limit_spend_cap_runtime_missing, object_storage_signed_retention_runtime_missing, eval_qa_safety_runtime_missing, staging_observability_restore_load_missing, external_user_legal_pages_missing.
- Open production blockers: `fixtures/stage0/rev2/release_gate_evidence.production_launch.json`: production_provider_or_comp_only_mode, production_paid_billing_lifecycle, production_security_launch_checks, production_backup_rollback_incident, production_legal_support_policy.
- Production do-not-launch conditions present: dev_mock_provider_public_claims_unresolved, real_provider_or_comp_only_mode_missing, paid_billing_or_comp_only_mode_missing, security_privacy_legal_incomplete, secret_exposure_runtime_not_verified, backup_restore_rollback_smoke_missing, production_deploy_rollback_smoke_missing, public_legal_support_policy_not_deployed, ci_staging_gates_not_passed.
- Operational risks: staging observability, restore, rollback, load, and post-deploy smoke evidence are absent.
- User/support risks: external-user legal/support pages and support readiness remain blocked by Rev2 gate evidence.

## Open Rev2 Runtime Checklist

- CI and staging runtime: 添加 PR/main CI 到 `.github/workflows`。（token-blocked：当前 token 缺 workflow scope；draft/evidence 已落在 `ops/ci/` 和 `fixtures/ops/`。）; CI 在已安装 PR/main workflow 中运行 Playwright smoke; CI 在已安装 PR/main workflow 中 build Docker images; 执行 staging deploy; 执行 staging smoke tests.
- Observability runtime: staging request id propagation runtime evidence 通过; staging structured JSON logs runtime evidence 通过; staging OpenTelemetry traces runtime evidence 通过.
- Release gate runtime: Local Alpha Gate 全部通过; CI Gate 全部通过; Private Beta/Staging Gate 全部通过; Production Launch Gate 全部通过; Do-Not-Launch Conditions 全部为 false; Local Alpha workflow API/Playwright end-to-end smoke evidence 通过并写入 release gate fixture; CI installed workflow runtime evidence 通过：PR/main run、Playwright smoke、Docker image build 均有 validator-resolvable evidence; Private Beta/Staging external-user runtime evidence 通过：auth/RBAC/tenant、storage、quota/rate limit、support/abuse、safety/QA/crawler、observability/backup/load、legal visibility 均有 staging evidence; Production Launch runtime/deployment evidence 通过：provider-or-comp-only、paid lifecycle、skill canary、activation audit、abuse hold、security、backup/rollback/post-deploy smoke、legal/support policy 均有 production evidence; Staging post-deploy smoke tests 通过; Production post-deploy smoke tests 通过.

## Go/No-Go

- Decision: `no-go`
- Approver: `pending`
- Conditions: CI, staging smoke, observability runtime evidence, restore/rollback evidence, security scans, release owner, and gate fixture blockers must be cleared before any private beta or production decision.
- Follow-up deadline: `n/a`
