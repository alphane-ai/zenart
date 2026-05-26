# Stage 0 Rev2 CI Installation Checklist

Authoritative source: `Docs/stage0_blueprint_rev2.md`

The executable workflow draft is `ops/ci/stage0-rev2-ci.yml`. It is intentionally not installed under `.github/workflows/` because the current automation token does not have GitHub Actions workflow scope.

## Open Checklist

- [ ] Blocked by token scope: copy or promote `ops/ci/stage0-rev2-ci.yml` to `.github/workflows/stage0-rev2-ci.yml` with a token that has workflow write permission.
- [ ] Protect `main` with the installed Stage 0 Rev2 CI as a required status check.
- [ ] Confirm PR and `main` triggers run after installation.
- [ ] Confirm SHA-tagged Docker image build jobs pass before staging promotion.
- [ ] Confirm Playwright smoke runs against started web/admin services and is required before staging promotion.

## Draft Coverage

The draft covers:

- Web/Admin lint, typecheck, unit test, and build.
- Backend gofmt, test, vet, and command builds.
- Postgres, Redis, and object storage service startup.
- Docker Compose syntax validation.
- migration and API/agent contract validation through backend tests and `scripts/validate_stage0_rev2.py`.
- OpenAPI/client stale checks through `scripts/generate_openapi_clients.py --check`.
- security scan smoke.
- Docker image build using the git SHA tag.
- Playwright smoke wrapper/spec draft in planned mode until the installed workflow can start runtime services.

Deferred gates are tracked in `ops/evidence/stage0_environment_evidence.json` instead of being marked complete in the blueprint.
