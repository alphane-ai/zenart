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
