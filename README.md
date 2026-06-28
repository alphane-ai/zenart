# Zenari

Zenari is an early-stage product planning repository for an agentic visual design workspace.

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
- CI Gate: go from `fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status=go`; installed workflow `.github/workflows/stage0-rev2-ci.yml` writes exact runtime evidence at `ops/evidence/ci/stage0-rev2-pr-main-run.json`, `ops/evidence/ci/stage0-rev2-playwright-smoke.json`, and `ops/evidence/ci/stage0-rev2-docker-image-build.json`.
- Private Beta/Staging Gate: go from `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json gate_decision.status=go`; validator-owned staging evidence covers auth/RBAC/tenant, object storage retention cleanup, quota/rate limit, support/abuse, safety/QA/crawler, observability/backup/load, and legal/support visibility.
- Production Launch Gate: no-go from `fixtures/stage0/rev2/release_gate_evidence.production_launch.json gate_decision.status=no_go`; blocked checks are `production_provider_or_comp_only_mode`, `production_paid_billing_lifecycle`, `production_skill_release_eval_canary`, `production_activation_review_audit`, `production_abuse_throttle_hold`, `production_security_launch_checks`, `production_backup_rollback_incident`, `production_legal_support_policy`; active production conditions are `dev_mock_provider_public_claims_unresolved`, `real_provider_or_comp_only_mode_missing`, `paid_billing_or_comp_only_mode_missing`, `skill_release_eval_canary_missing`, `activation_eval_review_audit_runtime_missing`, `admin_high_risk_review_runtime_missing`, `abuse_throttle_hold_missing`, `security_privacy_legal_incomplete`, `secret_exposure_runtime_not_verified`, `backup_restore_rollback_smoke_missing`, `production_deploy_rollback_smoke_missing`, `public_legal_support_policy_not_deployed`. Upstream CI `fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status=go` and Private Beta/Staging `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json gate_decision.status=go` are already go; production evidence currently exists as blocked diagnostics under `ops/evidence/production/`, including `ops/evidence/production/provider-mode.json`, `ops/evidence/production/public-paid-real-generation-claims.json`, `ops/evidence/production/billing-lifecycle.json`, `ops/evidence/production/backup-restore.json`, `ops/evidence/production/rollback-incident-post-deploy-smoke.json`, `ops/evidence/production/public-legal-policy.json`, and `ops/evidence/production/public-support-billing-policy.json`.
- Do-Not-Launch Conditions: open until all four release gate fixtures compute `go` and the authoritative checklist closes Production Launch; current required decisions are `fixtures/stage0/rev2/release_gate_evidence.local_alpha.json gate_decision.status=go`, `fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status=go`, `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json gate_decision.status=go`, and `fixtures/stage0/rev2/release_gate_evidence.production_launch.json gate_decision.status=no_go`; current active conditions are `dev_mock_provider_public_claims_unresolved`, `real_provider_or_comp_only_mode_missing`, `paid_billing_or_comp_only_mode_missing`, `skill_release_eval_canary_missing`, `activation_eval_review_audit_runtime_missing`, `admin_high_risk_review_runtime_missing`, `abuse_throttle_hold_missing`, `security_privacy_legal_incomplete`, `secret_exposure_runtime_not_verified`, `backup_restore_rollback_smoke_missing`, `production_deploy_rollback_smoke_missing`, `public_legal_support_policy_not_deployed`.

Do not close launch gates from README prose, draft CI files, blocked probe
artifacts, release-bundle validation artifacts, or fixture-only evidence.
