#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRILL_DIR="${DRILL_DIR:-ops/evidence/backup-restore/local}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
EVIDENCE_ENVIRONMENT="${EVIDENCE_ENVIRONMENT:-${ENVIRONMENT:-local}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$DRILL_DIR/$STAMP"
mkdir -p "$OUT_DIR"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-zenari-stage0-postgres-1}"
MINIO_CONTAINER="${MINIO_CONTAINER:-zenari-stage0-minio-1}"
POSTGRES_DB="${POSTGRES_DB:-zenari}"
POSTGRES_USER="${POSTGRES_USER:-zenari}"
OBJECT_STORAGE_BUCKET="${OBJECT_STORAGE_BUCKET:-zenari-local}"
DRY_RUN="${DRY_RUN:-0}"
RUN_OBJECT_RESTORE_COPY="${RUN_OBJECT_RESTORE_COPY:-true}"
RESTORE_PREFIX="${RESTORE_PREFIX:-restore-drill-$STAMP}"
SEED_EMPTY_OBJECT_BUCKET="${SEED_EMPTY_OBJECT_BUCKET:-true}"
RESTORE_DB="${POSTGRES_RESTORE_DB:-zenari_restore_drill_$(printf '%s' "$STAMP" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_')}"
DROP_RESTORE_DB_AFTER="${DROP_RESTORE_DB_AFTER:-true}"
RESTORED_OBJECT_COUNT=0
POSTGRES_DUMP_BYTES=0
POSTGRES_RESTORE_ITEMS=0
POSTGRES_RESTORE_TABLES=0
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
  local postgres_drill_status="open"
  local object_drill_status="open"
  if [[ "$status" == "passed" && "${POSTGRES_RESTORE_TABLES:-0}" =~ ^[0-9]+$ && "$POSTGRES_RESTORE_TABLES" -ge 1 ]]; then
    postgres_drill_status="passed"
  fi
  if [[ "$status" == "passed" && "${RESTORED_OBJECT_COUNT:-0}" =~ ^[0-9]+$ && "$RESTORED_OBJECT_COUNT" -ge 1 ]]; then
    object_drill_status="passed"
  fi
  cat >"$OUT_DIR/report.json" <<JSON
{
  "blueprint_source": "Docs/stage0_blueprint_rev2.md",
  "created_by_lane": "lane5",
  "created_at": "$STAMP",
  "kind": "backup_restore",
  "environment": "$EVIDENCE_ENVIRONMENT",
  "release_sha": "$RELEASE_SHA",
  "status": "$status",
  "postgres_dump": "$OUT_DIR/postgres.dump",
  "postgres_dump_bytes": $POSTGRES_DUMP_BYTES,
  "postgres_restore_list": "$OUT_DIR/postgres.restore.list",
  "postgres_restore_items": $POSTGRES_RESTORE_ITEMS,
  "postgres_restore_database": "$RESTORE_DB",
  "postgres_restore_tables": $POSTGRES_RESTORE_TABLES,
  "postgres_restore_verify": "$OUT_DIR/postgres.restore.verify.json",
  "drop_restore_database_after": "$DROP_RESTORE_DB_AFTER",
  "object_manifest": "$OUT_DIR/object-storage-manifest.txt",
  "object_manifest_count": $OBJECT_MANIFEST_COUNT,
  "run_object_restore_copy": "$RUN_OBJECT_RESTORE_COPY",
  "seed_empty_object_bucket": "$SEED_EMPTY_OBJECT_BUCKET",
  "restore_prefix": "$RESTORE_PREFIX",
  "restored_object_count": $RESTORED_OBJECT_COUNT,
  "drills": [
    {
      "drill_id": "postgres_restore",
      "status": "$postgres_drill_status",
      "evidence_refs": [
        "$OUT_DIR/postgres.dump",
        "$OUT_DIR/postgres.restore.list",
        "$OUT_DIR/postgres.restore.verify.json"
      ]
    },
    {
      "drill_id": "object_restore",
      "status": "$object_drill_status",
      "evidence_refs": [
        "$OUT_DIR/object-storage-manifest.txt",
        "$OUT_DIR/object-restore-count.txt",
        "$OUT_DIR/object-restore-verify-count.txt"
      ]
    }
  ],
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
docker exec -i "$POSTGRES_CONTAINER" pg_restore --list <"$OUT_DIR/postgres.dump" >"$OUT_DIR/postgres.restore.list"
POSTGRES_DUMP_BYTES="$(file_bytes "$OUT_DIR/postgres.dump")"
POSTGRES_RESTORE_ITEMS="$(grep -Ec '^[0-9]+; ' "$OUT_DIR/postgres.restore.list" || true)"

docker exec "$POSTGRES_CONTAINER" dropdb -U "$POSTGRES_USER" --if-exists "$RESTORE_DB"
docker exec "$POSTGRES_CONTAINER" createdb -U "$POSTGRES_USER" "$RESTORE_DB"
if ! docker exec -i "$POSTGRES_CONTAINER" pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DB" --clean --if-exists <"$OUT_DIR/postgres.dump" >"$OUT_DIR/postgres.restore.log" 2>&1; then
  printf 'postgres restore failed; see %s\n' "$OUT_DIR/postgres.restore.log" >&2
  write_report "failed_postgres_restore"
  exit 1
fi
docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$RESTORE_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" >"$OUT_DIR/postgres.restore.tables"
POSTGRES_RESTORE_TABLES="$(tr -d ' ' <"$OUT_DIR/postgres.restore.tables")"
python3 - "$OUT_DIR/postgres.restore.verify.json" "$RESTORE_DB" "$POSTGRES_RESTORE_TABLES" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(json.dumps({
    "database": sys.argv[2],
    "restored_table_count": int(sys.argv[3]),
    "minimum_expected_tables": 1,
    "passed": int(sys.argv[3]) >= 1,
}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
if [[ "$POSTGRES_RESTORE_TABLES" -lt 1 ]]; then
  printf 'postgres restore verification failed: no public tables restored into %s\n' "$RESTORE_DB" >&2
  write_report "failed_postgres_restore_verify"
  exit 1
fi
if [[ "$DROP_RESTORE_DB_AFTER" == "true" ]]; then
  docker exec "$POSTGRES_CONTAINER" dropdb -U "$POSTGRES_USER" "$RESTORE_DB"
fi

docker exec "$MINIO_CONTAINER" sh -ec "
  bucket=/data/${OBJECT_STORAGE_BUCKET}
  mkdir -p \"\$bucket\"
  has_object=false
  for object in \"\$bucket\"/* \"\$bucket\"/*/* \"\$bucket\"/*/*/*; do
    if [ -f \"\$object\" ]; then
      has_object=true
      break
    fi
  done
  if [ \"\$has_object\" = false ] && [ \"${SEED_EMPTY_OBJECT_BUCKET}\" = true ]; then
    mkdir -p \"\$bucket/drill-source\"
    printf 'stage0 object restore drill marker %s\n' '${STAMP}' >\"\$bucket/drill-source/package-manifest.json\"
  fi
  for object in \"\$bucket\"/* \"\$bucket\"/*/* \"\$bucket\"/*/*/*; do
    [ -f \"\$object\" ] || continue
    printf '%s\n' \"\$object\"
  done
" >"$OUT_DIR/object-storage-manifest.txt"
OBJECT_MANIFEST_COUNT="$(grep -c . "$OUT_DIR/object-storage-manifest.txt" || true)"
test -s "$OUT_DIR/postgres.restore.list"
test -f "$OUT_DIR/object-storage-manifest.txt"

if [[ "$RUN_OBJECT_RESTORE_COPY" == "true" ]]; then
  docker exec "$MINIO_CONTAINER" sh -ec "
    set -eu
    bucket=/data/${OBJECT_STORAGE_BUCKET}
    mkdir -p \"\$bucket/${RESTORE_PREFIX}\"
    count=0
    for object in \"\$bucket\"/* \"\$bucket\"/*/* \"\$bucket\"/*/*/*; do
      [ -f \"\$object\" ] || continue
      case \"\$object\" in
        */${RESTORE_PREFIX}/*) continue ;;
      esac
      base=\${object##*/}
      target=\"\$bucket/${RESTORE_PREFIX}/\$count-\$base\"
      cp \"\$object\" \"\$target\"
      count=\$((count + 1))
      [ \"\$count\" -ge 20 ] && break
    done
    if [ \"\$count\" -lt 1 ]; then
      printf 'no source objects available for restore copy\n' >&2
      exit 3
    fi
    printf '%s\n' \"\$count\"
  " >"$OUT_DIR/object-restore-count.txt"
  RESTORED_OBJECT_COUNT="$(cat "$OUT_DIR/object-restore-count.txt")"
  docker exec "$MINIO_CONTAINER" sh -ec "
    count=0
    for object in /data/${OBJECT_STORAGE_BUCKET}/${RESTORE_PREFIX}/*; do
      [ -f \"\$object\" ] || continue
      count=\$((count + 1))
    done
    printf '%s\n' \"\$count\"
  " >"$OUT_DIR/object-restore-verify-count.txt"
  RESTORE_VERIFY_COUNT="$(tr -d ' ' <"$OUT_DIR/object-restore-verify-count.txt")"
  if [[ "$RESTORE_VERIFY_COUNT" != "$RESTORED_OBJECT_COUNT" ]]; then
    printf 'object restore verification mismatch: copied=%s verified=%s\n' "$RESTORED_OBJECT_COUNT" "$RESTORE_VERIFY_COUNT" >&2
    write_report "failed_object_restore_verify"
    exit 1
  fi
fi

write_report "passed"
printf 'backup/restore drill evidence written to %s\n' "$OUT_DIR"
