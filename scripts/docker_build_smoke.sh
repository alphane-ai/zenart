#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN="${DRY_RUN:-0}"
OUT_DIR="${OUT_DIR:-ops/evidence/docker/local}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
GIT_SHA="${GIT_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || printf 'unknown')}"
RUN_ID="${STAMP}-docker-build-${GIT_SHA}-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
LOG_PATH="$OUT_DIR/${RUN_ID}.log"
IMAGE_PREFIX="${IMAGE_PREFIX:-zenart-stage0}"
IMAGE_SET="${IMAGE_SET:-backend web admin manager}"

write_report() {
  local status="$1"
  local exit_code="${2:-0}"
  local images_json
  images_json="$(printf '%s\n' $IMAGE_SET | python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')"
  mkdir -p "$OUT_DIR"
  cat >"$REPORT_PATH" <<JSON
{
  "blueprint_source": "Docs/stage0_blueprint_rev2.md",
  "created_by_lane": "lane5",
  "created_at": "$STAMP",
  "run_id": "$RUN_ID",
  "status": "$status",
  "git_sha": "$GIT_SHA",
  "image_prefix": "$IMAGE_PREFIX",
  "image_set": $images_json,
  "log_path": "$LOG_PATH",
  "exit_code": $exit_code,
  "ci_gate": "open_until_installed_ci_builds_sha_tagged_images_on_pr_and_main",
  "staging_gate": "open_until_sha_tagged_images_are_promoted_and_smoked_in_staging"
}
JSON
}

build_image() {
  local name="$1"
  local context="$1"
  if [[ "$name" != "backend" && "$name" != "web" && "$name" != "admin" && "$name" != "manager" ]]; then
    printf 'unsupported image name: %s\n' "$name" >&2
    return 64
  fi
  docker build --tag "${IMAGE_PREFIX}-${name}:${GIT_SHA}" "$context"
}

if [[ "$DRY_RUN" == "1" ]]; then
  write_report "planned" 0
  printf 'Docker image build dry-run planned for git SHA %s\n' "$GIT_SHA"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker is required for image build smoke\n' >&2
  write_report "blocked_missing_docker" 127
  exit 127
fi

mkdir -p "$OUT_DIR"
set +e
{
  printf 'docker build smoke started at %s for git SHA %s\n' "$STAMP" "$GIT_SHA"
  for image in $IMAGE_SET; do
    printf '\n==> building %s\n' "$image"
    build_image "$image"
  done
} >"$LOG_PATH" 2>&1
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  write_report "passed" 0
  printf 'Docker image build smoke passed; evidence written to %s\n' "$REPORT_PATH"
  exit 0
fi

write_report "failed" "$status"
printf 'Docker image build smoke failed with exit code %s; see %s\n' "$status" "$LOG_PATH" >&2
exit "$status"
