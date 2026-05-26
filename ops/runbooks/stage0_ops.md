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

Rev2 production gates remain open until request id propagation, structured JSON logs, OpenTelemetry traces, backend/worker/crawler metrics, frontend error reporting, dashboards, and alerts have runtime evidence in staging.

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
