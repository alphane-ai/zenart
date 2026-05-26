#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRILL_DIR="${DRILL_DIR:-ops/evidence/backup-restore/local}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$DRILL_DIR/$STAMP"
mkdir -p "$OUT_DIR"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-zenart-stage0-postgres-1}"
MINIO_CONTAINER="${MINIO_CONTAINER:-zenart-stage0-minio-1}"
POSTGRES_DB="${POSTGRES_DB:-zenart}"
POSTGRES_USER="${POSTGRES_USER:-zenart}"
OBJECT_STORAGE_BUCKET="${OBJECT_STORAGE_BUCKET:-zenart-local}"

write_report() {
  local status="$1"
  cat >"$OUT_DIR/report.json" <<JSON
{
  "blueprint_source": "Docs/stage0_blueprint_rev2.md",
  "created_by_lane": "lane5",
  "created_at": "$STAMP",
  "status": "$status",
  "postgres_dump": "$OUT_DIR/postgres.dump",
  "object_manifest": "$OUT_DIR/object-storage-manifest.txt",
  "rpo_target": "24h for local alpha scaffold; staging/prod value must be tightened before launch",
  "rto_target": "4h for local alpha scaffold; staging/prod value must be tightened before launch"
}
JSON
}

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker is required for backup restore drill\n' >&2
  exit 127
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
  printf 'postgres container %s is not running; start docker compose services first\n' "$POSTGRES_CONTAINER" >&2
  exit 2
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$MINIO_CONTAINER"; then
  printf 'minio container %s is not running; start docker compose services first\n' "$MINIO_CONTAINER" >&2
  exit 2
fi

docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom >"$OUT_DIR/postgres.dump"
docker exec "$POSTGRES_CONTAINER" pg_restore --list <"$OUT_DIR/postgres.dump" >"$OUT_DIR/postgres.restore.list"

docker exec "$MINIO_CONTAINER" sh -ec "find /data/${OBJECT_STORAGE_BUCKET} -maxdepth 3 -type f | sort" >"$OUT_DIR/object-storage-manifest.txt"
test -s "$OUT_DIR/postgres.restore.list"
test -f "$OUT_DIR/object-storage-manifest.txt"

write_report "passed"
printf 'backup/restore drill evidence written to %s\n' "$OUT_DIR"
