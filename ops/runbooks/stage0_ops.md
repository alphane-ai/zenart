# ZenArt Stage 0 Rev2 Ops Runbook

Authoritative source: `Docs/stage0_blueprint_rev2.md`

## Environments

| Environment | Purpose | Entry command | Release control |
| --- | --- | --- | --- |
| local | Deterministic dev-provider alpha loop | `docker compose --env-file .env.example up --build` | Any developer branch |
| CI | Contract, fixture, backend, conditional frontend, compose, and scan validation | `.github/workflows/ci.yml` | Pull request and `main` |
| staging | Private beta rehearsal with production-like dependencies | CI image promoted with git SHA tag | Manual environment approval |
| production | Public or invite/comp-only launch after do-not-launch gate passes | Release tag using approved git SHA image | Protected production approval |

## SLOs

| Signal | Local alpha target | Staging/production gate |
| --- | --- | --- |
| API p95 latency | Recorded by load smoke, no enforced threshold yet | <= 500 ms for non-generation API |
| Queue delay p95 | Logged by worker metrics when implemented | <= 60 s for accepted generation tasks |
| Export duration p95 | Recorded by export load smoke when implemented | <= 120 s for starter packages |
| UI load p95 | Conditional Playwright/web perf check when web exists | <= 3 s dashboard and workspace shell |
| Error rate | Load smoke must return expected status codes | < 1% 5xx over 30 minutes |

Evidence map: `ops/evidence/stage0_observability_evidence.json`.

Dashboard definition: `ops/observability/dashboards/stage0_rev2_overview.json`.

Alert definition: `ops/observability/alerts/stage0_rev2_alerts.json`.

Rev2 production gates remain open until request id propagation, structured JSON logs, OpenTelemetry traces, backend/worker/crawler metrics, frontend error reporting, imported dashboards, and evaluated alerts have runtime evidence in staging.

## SLO Alerts

The Stage 0 dashboard and alert contracts are versioned under `ops/observability/`. They define the go/no-go signals required before private beta, but they are not staging evidence until imported into the selected monitoring system and populated with release-SHA-labelled runtime data.

Before private beta:

1. Import `ops/observability/dashboards/stage0_rev2_overview.json` into the monitoring stack or translate it losslessly to the provider's native format.
2. Import `ops/observability/alerts/stage0_rev2_alerts.json` and bind `stage0-ops`, `stage0-incident-lead`, and `stage0-support` routes.
3. Run `scripts/observability_smoke.sh` against staging with a unique `X-Request-ID`.
4. Attach dashboard snapshots, alert dry-run evaluations, and notification-route evidence to release notes.
5. Keep the private beta and production gates open if any go/no-go signal lacks data or an alert route is untested.

### SLO Alerts

API p95 latency above 500 ms for 15 minutes is SEV3. API 5xx rate above 1% for 30 minutes is SEV2. Preserve the request id, release SHA, route, status code, tenant id, and trace id labels while investigating.

### Worker Alerts

Worker queue delay p95 above 60 seconds for 15 minutes is SEV2. Drain workers before rollback when queued tasks may cross schema versions.

### Export Alerts

Export duration p95 above 120 seconds for 15 minutes is SEV3. Object storage errors above zero for 10 minutes are SEV2.

### Provider Alerts

Provider error rate above 2% for 15 minutes is SEV2. Confirm fallback behavior, cost logging, and quota refund behavior before reopening traffic.

### Object Storage Alerts

Upload, download, signed URL, or export object errors must be triaged with object metadata, package manifest, and tenant isolation evidence.

### Quota Alerts

Quota contention above 10 events in 30 minutes is SEV3. Verify reservation, commit, refund, and idempotency paths.

### Crawler Alerts

Crawler denied or failed governance decisions above zero in 30 minutes are SEV3. Stop imports until robots, blocklist, source approval, and retention evidence are checked.

### Safety Alerts

Any critical safety block is SEV2. Keep export override and release activation disabled until the safety decision, QA result, and audit log evidence are reviewed.

### Admin Alerts

Admin RBAC denial spikes above 5 events in 15 minutes are SEV2. Check role assignments, audit log integrity, and attempted endpoint scope.

### Frontend Alerts

Web/Admin frontend error rate above 1% for 30 minutes is SEV3. Attach release SHA and source map policy evidence before treating this as launch-ready.

## Incident Severity

| Severity | Examples | Escalation | Initial update |
| --- | --- | --- | --- |
| SEV1 | Data loss, cross-tenant exposure, payment corruption, provider abuse | Incident lead plus engineering owner immediately | 15 minutes |
| SEV2 | Export outage, auth outage, worker backlog blocking beta users | Engineering owner and support operator | 30 minutes |
| SEV3 | Degraded generation quality, crawler disabled, non-critical admin outage | Owning lane or on-call engineer | Next business day |

## Incident Template

1. Incident id and severity.
2. Start time, detection source, current status.
3. User impact and affected tenants/projects.
4. Suspected cause and changed artifacts.
5. Mitigation, rollback, or feature flag action.
6. Evidence links: logs, traces, dashboards, commits, deploys.
7. Follow-up owner, deadline, and regression test.

## Rollback

1. Stop new deploys and preserve logs.
2. Drain worker queues before schema or provider rollback where possible.
3. Disable risky features with feature flags before reverting images.
4. Re-deploy the last known good git SHA tag.
5. Run post-deploy smoke: `/healthz`, `/readyz`, task status, export path, signed download path.
6. Record the rollback in the incident log and release evidence.

## Backup And Restore

| Component | Local alpha schedule | Staging/production target |
| --- | --- | --- |
| Postgres | Manual drill with `scripts/backup_restore_drill.sh` | Automated daily full backup plus PITR |
| Object storage | Manifest/versioning drill with `scripts/backup_restore_drill.sh` | Bucket versioning plus daily inventory |
| Redis | No durable source of record | No backup unless durable queues move to Redis |

RPO target: 24 hours for local alpha scaffold; staging/production must set a tighter value before launch.

RTO target: 4 hours for local alpha scaffold; staging/production must set a tighter value before launch.

Local drill command:

```bash
scripts/backup_restore_drill.sh
```

Optional local object-copy verification:

```bash
RUN_OBJECT_RESTORE_COPY=true scripts/backup_restore_drill.sh
```

The local drill writes `report.json` under `ops/evidence/backup-restore/local/<timestamp>/` with Postgres dump bytes, restore-list item count, object manifest count, and optional object restore-copy verification. This is not production restore evidence; staging and production still require automated backups, PITR, isolated restore, bucket versioning, and release-owner sign-off.

## Load Assumptions

Local smoke starts with 20 requests at concurrency 4 across health, readiness, and task status endpoints. Before private beta, expand the same script family to cover chat/task creation, worker generation, ZIP export, signed download, crawler throttle, quota contention, and workspace rendering.

Mode examples:

```bash
LOAD_MODE=chat_task scripts/load_smoke.sh
LOAD_MODE=worker_generation scripts/load_smoke.sh
LOAD_MODE=zip_export scripts/load_smoke.sh
LOAD_MODE=signed_download scripts/load_smoke.sh
LOAD_MODE=crawler_throttle scripts/load_smoke.sh
LOAD_MODE=quota_contention scripts/load_smoke.sh
LOAD_MODE=workspace_rendering scripts/load_smoke.sh
```

Each run writes a JSON summary and NDJSON request records under `ops/evidence/load/local/`. Runtime load evidence is local smoke only until staging runs enforce the Rev2 SLO thresholds.

## Staging Observability Backup Load Preflight

The private beta `staging_observability_backup_load` check stays open until staging evidence exists for observability, restore, and load in one release-SHA-bound bundle. Use this preflight after the individual staging artifacts have been produced and before running the full post-deploy smoke bundle:

```bash
RELEASE_SHA=<deploy-sha> \
OBSERVABILITY_EVIDENCE=ops/evidence/staging/<observability>.json \
BACKUP_RESTORE_EVIDENCE=ops/evidence/staging/<backup-restore>.json \
LOAD_EVIDENCE=ops/evidence/staging/<load>.json \
scripts/staging_observability_backup_load_smoke.sh
```

The script requires top-level `environment=staging`, the deploy `release_sha`, and the expected `kind` on each JSON file. Observability must include request-id propagation, structured JSON logs, OpenTelemetry traces, backend/worker/crawler metrics, dashboard import, and alert routes. Restore must include Postgres restore and object restore. Load must include `chat_task`, `worker_generation`, `zip_export`, `signed_download`, `crawler_throttle`, `quota_contention`, and `workspace_rendering`.

If any slot is missing or incomplete, the script exits 2 and writes a blocked report under `ops/evidence/staging-observability-backup-load/`. That blocked report is useful operational evidence, but it does not close private beta or production gates.
