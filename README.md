# ZenArt

ZenArt is an early-stage product planning repository for an agentic visual design workspace.

The current authoritative source of truth is:

- [Docs/stage0_blueprint_rev2.md](Docs/stage0_blueprint_rev2.md)

Stage 0 Rev2 targets an Alphane-style pure Web three-surface monorepo:

- `web/`: user-facing Next.js application.
- `admin/`: admin Next.js application.
- `backend/`: Go API, worker, crawler, and migration commands.

Local development target:

```bash
docker compose up --build
```

Stage 0 Rev2 launch-readiness validation:

```bash
python3 scripts/validate_stage0_rev2.py
```

Current Stage 0 Rev2 launch-readiness snapshot:

- Local Alpha Gate: go, backed by `fixtures/stage0/rev2/release_gate_evidence.local_alpha.json` and exact workflow API, Playwright, and export ZIP evidence under `ops/evidence/local_alpha/`.
- CI Gate: no-go until the installed workflow exists at `.github/workflows/stage0-rev2-ci.yml` and exact runtime evidence exists at `ops/evidence/ci/stage0-rev2-pr-main-run.json`, `ops/evidence/ci/stage0-rev2-playwright-smoke.json`, and `ops/evidence/ci/stage0-rev2-docker-image-build.json`.
- Private Beta/Staging Gate: no-go while `staging_object_storage_signed_downloads` is blocked and `object_storage_signed_retention_runtime_missing` remains active; signed URL evidence is present at `ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json`, but production-like object retention cleanup evidence is still missing at `ops/evidence/staging/object-storage-retention-cleanup.json`.
- Production Launch Gate: no-go while `production_backup_rollback_incident` is blocked and `backup_restore_rollback_smoke_missing`, `production_deploy_rollback_smoke_missing`, and `ci_staging_gates_not_passed` remain active; upstream fixtures are still `fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status=no_go` and `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json gate_decision.status=no_go`, and exact production backup/restore and rollback/incident/post-deploy smoke evidence is still missing at `ops/evidence/production/backup-restore.json` and `ops/evidence/production/rollback-incident-post-deploy-smoke.json`.
- Do-Not-Launch Conditions: open until all four release gate fixtures compute `go` and the authoritative checklist closes Local Alpha, CI, Private Beta/Staging, and Production Launch gates; currently `fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status=no_go`, `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json gate_decision.status=no_go`, and `fixtures/stage0/rev2/release_gate_evidence.production_launch.json gate_decision.status=no_go` preserve active blockers including `ci_workflow_not_installed`, `object_storage_signed_retention_runtime_missing`, and `ci_staging_gates_not_passed`.

Do not close launch gates from README prose, draft CI files, blocked probe
artifacts, release-bundle validation artifacts, or fixture-only evidence.
