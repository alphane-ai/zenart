# ZenArt

ZenArt is an early-stage product planning repository for an agentic visual design workspace.

The current authoritative source of truth is:

- [Docs/stage0_blueprint_rev2.md](Docs/stage0_blueprint_rev2.md)

Stage 0 Rev2 targets an Alphane-style pure Web three-surface monorepo:

- `web/`: user-facing Next.js application.
- `admin/`: admin Next.js application.
- `manager/`: manager-facing Next.js application for release, delivery, and local-stack status.
- `backend/`: Go API, worker, crawler, and migration commands.

Local development target:

```bash
docker compose up --build
```

Registered local ports are backend `31080`, user web `26080`, admin `26081`,
and manager `26082`; the supporting Postgres, Redis, and MinIO ports are listed
in `~/.devport`.

Local CI:

```bash
scripts/local_ci.sh
```

By default the local CI runs contract validation, generated-client stale checks,
backend Go checks, Web/Admin lint/typecheck/test/build, and dry-run smoke
wrappers. Optional runtime gates are explicit:

```bash
LOCAL_CI_DOCKER=1 scripts/local_ci.sh
LOCAL_CI_DOCKER_BUILD=1 scripts/local_ci.sh
LOCAL_CI_PLAYWRIGHT=1 scripts/local_ci.sh
```
