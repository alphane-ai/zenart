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
DRY_RUN="${DRY_RUN:-0}"
RUN_OBJECT_RESTORE_COPY="${RUN_OBJECT_RESTORE_COPY:-false}"
RESTORE_PREFIX="${RESTORE_PREFIX:-restore-drill-$STAMP}"
RESTORED_OBJECT_COUNT=0
POSTGRES_DUMP_BYTES=0
POSTGRES_RESTORE_ITEMS=0
OBJECT_MANIFEST_COUNT=0

file_bytes() {
  if [[ -f "$1" ]]; then
    wc -c <"$1" | tr -d ' '
  else
    printf '0'
  fi
}

write_report() {
  local status="$1"
  cat >"$OUT_DIR/report.json" <<JSON
{
  "blueprint_source": "Docs/stage0_blueprint_rev2.md",
  "created_by_lane": "lane5",
  "created_at": "$STAMP",
  "status": "$status",
  "postgres_dump": "$OUT_DIR/postgres.dump",
  "postgres_dump_bytes": $POSTGRES_DUMP_BYTES,
  "postgres_restore_list": "$OUT_DIR/postgres.restore.list",
  "postgres_restore_items": $POSTGRES_RESTORE_ITEMS,
  "object_manifest": "$OUT_DIR/object-storage-manifest.txt",
  "object_manifest_count": $OBJECT_MANIFEST_COUNT,
  "run_object_restore_copy": "$RUN_OBJECT_RESTORE_COPY",
  "restore_prefix": "$RESTORE_PREFIX",
  "restored_object_count": $RESTORED_OBJECT_COUNT,
  "rpo_target": "24h for local alpha scaffold; staging/prod value must be tightened before launch",
  "rto_target": "4h for local alpha scaffold; staging/prod value must be tightened before launch",
  "production_gate": "open_until_automated_backups_pitr_and_isolated_staging_restore_pass"
}
JSON
}

if [[ "$DRY_RUN" == "1" ]]; then
  write_report "planned"
  printf 'backup/restore drill dry-run planned at %s\n' "$OUT_DIR"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker is required for backup restore drill\n' >&2
  write_report "blocked_missing_docker"
  exit 127
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
  printf 'postgres container %s is not running; start docker compose services first\n' "$POSTGRES_CONTAINER" >&2
  write_report "blocked_postgres_not_running"
  exit 2
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$MINIO_CONTAINER"; then
  printf 'minio container %s is not running; start docker compose services first\n' "$MINIO_CONTAINER" >&2
  write_report "blocked_minio_not_running"
  exit 2
fi

docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom >"$OUT_DIR/postgres.dump"
docker exec "$POSTGRES_CONTAINER" pg_restore --list <"$OUT_DIR/postgres.dump" >"$OUT_DIR/postgres.restore.list"
POSTGRES_DUMP_BYTES="$(file_bytes "$OUT_DIR/postgres.dump")"
POSTGRES_RESTORE_ITEMS="$(grep -Ec '^[0-9]+; ' "$OUT_DIR/postgres.restore.list" || true)"

docker exec "$MINIO_CONTAINER" sh -ec "
  if [ -d /data/${OBJECT_STORAGE_BUCKET} ]; then
    find /data/${OBJECT_STORAGE_BUCKET} -maxdepth 3 -type f | sort
  fi
" >"$OUT_DIR/object-storage-manifest.txt"
OBJECT_MANIFEST_COUNT="$(grep -c . "$OUT_DIR/object-storage-manifest.txt" || true)"
test -s "$OUT_DIR/postgres.restore.list"
test -f "$OUT_DIR/object-storage-manifest.txt"

if [[ "$RUN_OBJECT_RESTORE_COPY" == "true" ]]; then
  docker exec "$MINIO_CONTAINER" sh -ec "
    set -eu
    mkdir -p /data/${OBJECT_STORAGE_BUCKET}/${RESTORE_PREFIX}
    count=0
    for object in \$(find /data/${OBJECT_STORAGE_BUCKET} -maxdepth 3 -type f ! -path '*/${RESTORE_PREFIX}/*' | sort | head -20); do
      target=/data/${OBJECT_STORAGE_BUCKET}/${RESTORE_PREFIX}/\$(basename \"\$object\")
      cp \"\$object\" \"\$target\"
      count=\$((count + 1))
    done
    printf '%s\n' \"\$count\"
  " >"$OUT_DIR/object-restore-count.txt"
  RESTORED_OBJECT_COUNT="$(cat "$OUT_DIR/object-restore-count.txt")"
  docker exec "$MINIO_CONTAINER" sh -ec "find /data/${OBJECT_STORAGE_BUCKET}/${RESTORE_PREFIX} -maxdepth 1 -type f 2>/dev/null | wc -l" >"$OUT_DIR/object-restore-verify-count.txt"
  RESTORE_VERIFY_COUNT="$(tr -d ' ' <"$OUT_DIR/object-restore-verify-count.txt")"
  if [[ "$RESTORE_VERIFY_COUNT" != "$RESTORED_OBJECT_COUNT" ]]; then
    printf 'object restore verification mismatch: copied=%s verified=%s\n' "$RESTORED_OBJECT_COUNT" "$RESTORE_VERIFY_COUNT" >&2
    write_report "failed_object_restore_verify"
    exit 1
  fi
fi

write_report "passed"
printf 'backup/restore drill evidence written to %s\n' "$OUT_DIR"
