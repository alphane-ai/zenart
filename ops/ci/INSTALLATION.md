# Stage 0 Rev2 CI Installation Checklist

Authoritative source: `Docs/stage0_blueprint_rev2.md`

The executable workflow draft is `ops/ci/stage0-rev2-ci.yml`. It has been installed locally as `.github/workflows/stage0-rev2-ci.yml` with the same Stage 0 Rev2 validation, Playwright smoke, and Docker image build jobs.

## Open Checklist

- [x] Copy or promote `ops/ci/stage0-rev2-ci.yml` to `.github/workflows/stage0-rev2-ci.yml`.
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
- Playwright smoke wrapper/spec against started web/admin services.
- CI runtime evidence writer and Actions artifact uploads for workflow-run, Playwright smoke, and Docker image build results under `ops/evidence/ci/`.
- CI runtime artifact promotion through `python3 scripts/promote_ci_runtime_artifacts.py --input-dir <downloaded-actions-artifacts> --copy-raw`; this refuses local or non-PR/main evidence and writes canonical files only after workflow-run, Playwright smoke, and backend/web/admin Docker build evidence all pass.

Deferred gates are tracked in `ops/evidence/stage0_environment_evidence.json` instead of being marked complete in the blueprint.
