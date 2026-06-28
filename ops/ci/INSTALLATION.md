# Stage 0 Rev2 CI Installation Checklist

Authoritative source: `Docs/stage0_blueprint_rev2.md`

The installed workflow is now `.github/workflows/stage0-rev2-ci.yml`. The mirror template at `ops/ci/stage0-rev2-ci.yml` is kept byte-for-byte aligned so installation docs, local validation, and the GitHub Actions workflow describe the same Stage 1 pre-launch gate.

## Open Checklist

- [x] Install `.github/workflows/stage0-rev2-ci.yml` from the Stage 0 Rev2 draft and Stage 1 pre-launch contract baseline.
- [ ] Protect `main` with the installed Stage 0 Rev2 CI as a required status check.
- [ ] Confirm PR and `main` triggers run after installation.
- [ ] Confirm SHA-tagged Docker image build jobs pass before staging promotion.
- [ ] Confirm Playwright smoke runs against started web/admin/backend services and is required before staging promotion.

## Workflow Coverage

The workflow covers:

- Web/Admin lint, typecheck, unit test where present, and build.
- Backend gofmt, test, vet, and command builds.
- Postgres, Redis, and object storage service startup.
- Docker Compose syntax validation.
- migration and API/agent contract validation through backend tests and `scripts/validate_stage0_rev2.py`.
- OpenAPI/client stale checks through `scripts/generate_openapi_clients.py --check`.
- Stage 1 blueprint, scope, provider, batch, billing, safety, export, staging, and production-launch contract validators.
- Stripe sandbox selftest when CI Stripe test secrets are configured.
- security scan smoke.
- exact PR/main, Docker image build, Playwright smoke CI evidence artifacts, plus a final aggregate job that validates all three canonical files together.
- Docker image build using the git SHA tag.
- Playwright smoke against started web/admin/backend runtime services.

Deferred gates are tracked in `ops/evidence/stage0_environment_evidence.json` instead of being marked complete in the blueprint.
