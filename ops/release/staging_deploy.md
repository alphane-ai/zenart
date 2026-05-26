# Stage 0 Rev2 Staging Deploy Draft

Authoritative source: `Docs/stage0_blueprint_rev2.md`.

This is an operations draft only. Private beta and production gates remain open until a release owner promotes SHA-tagged images into a real staging environment with production-like Postgres, Redis, object storage, observability, backups, and rollback controls.

## Preconditions

- Installed CI workflow has passed on the exact git SHA.
- SHA-tagged `backend`, `web`, and `admin` images exist.
- Staging secrets are loaded from the approved secret source, not from `.env.example`.
- Staging Postgres migrations use the same migration command intended for production.
- Staging object storage uses an S3-compatible bucket with signed URL configuration and backup/versioning policy.
- Rollback target SHA and feature flag rollback plan are named before deploy starts.

## Deploy Steps

1. Record the release SHA, image tags, migration list, config diff, feature flag diff, owner, rollback SHA, and expected smoke command in release notes.
2. Drain or pause worker intake before migrations when a schema compatibility note requires it.
3. Run forward-only migrations against staging.
4. Deploy the SHA-tagged backend, worker, crawler, web, and admin images.
5. Produce validator-resolvable staging JSON evidence for migration, config diff, observability, backup/restore, rollback, and security. Each evidence file must reference the release SHA, set `environment=staging`, set the required `kind`, and record an accepted pass/review status.
   - Observability evidence must include request-id propagation, structured JSON logs, OpenTelemetry traces, backend/worker/crawler metrics, dashboard import, and alert routes. Each entry must carry a trace, query, dashboard, alert, report, or evidence reference.
   - Backup/restore evidence must include both Postgres restore and exported package/object restore drill entries with report references.
   - Load evidence must include `chat_task`, `worker_generation`, `zip_export`, `signed_download`, `crawler_throttle`, `quota_contention`, and `workspace_rendering` entries with report references.
   - Rollback evidence must include image rollback, feature flag rollback, migration compatibility, worker drain, and post-rollback smoke entries with report references.
   - Security evidence must include dependency, image/container, and committed-secret scan entries with report references.
6. Run `scripts/staging_smoke.sh` with `STAGING_BASE_URL`, `STAGING_WEB_URL`, `STAGING_ADMIN_URL`, `RELEASE_SHA`, release notes, image refs, seeded smoke IDs, and every evidence path from the previous step. The generated report must set `environment=staging`, set `kind=post_deploy_smoke`, record status `passed`, and verify backend health/readiness, web, admin, auth boundary, worker task, export/package, signed download, crawler admin, quota/rate-limit, and request-id observability categories.
7. Run representative load smoke modes from `scripts/load_smoke.sh` against staging URLs.
8. Confirm logs, metrics, traces, dashboards, alerts, and backup jobs are producing staging evidence.
9. Attach smoke/load/restore evidence to the release notes before any private beta decision.

## Rollback

1. Disable provider/crawler/analytics risk flags when the failure mode is active ingestion or external calls.
2. Promote the previous SHA-tagged images.
3. Do not roll back database migrations destructively; use expand/contract compatibility or a forward repair migration.
4. Re-run `scripts/staging_smoke.sh`.
5. Record the incident and rollback result in release evidence.
