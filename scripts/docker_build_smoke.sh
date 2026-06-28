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
IMAGE_PREFIX="${IMAGE_PREFIX:-zenari-stage0}"
IMAGE_SET="${IMAGE_SET:-backend web admin}"
# Stage1 release images are backend, web, and admin. The backend image carries
# runtime-server and runtime-worker targets for rollback/drain evidence; worker
# is not a standalone release image.
RUNTIME_TARGETS="${RUNTIME_TARGETS:-runtime-server runtime-worker}"

images_report_json() {
  python3 - "$IMAGE_PREFIX" "$GIT_SHA" "$LOG_PATH" "$IMAGE_SET" <<'PY'
import json
import subprocess
import sys

prefix = sys.argv[1]
git_sha = sys.argv[2]
log_path = sys.argv[3]
images = [item for item in sys.argv[4].split() if item]

targets = {
    "backend": "",
    "web": "",
    "admin": "",
}
runtime_targets = {
    "backend": ["runtime-server", "runtime-worker"],
    "web": [],
    "admin": [],
}
contexts = {
    "backend": "backend",
    "web": "web",
    "admin": "admin",
}

rows = {}
for name in images:
    tag = f"{prefix}-{name}:{git_sha}"
    digest = ""
    status = "passed"
    try:
        image_id = subprocess.check_output(
            ["docker", "image", "inspect", tag, "--format", "{{.Id}}"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        if image_id.startswith("sha256:") and len(image_id) >= 71:
            digest = image_id
        else:
            status = "failed"
    except Exception:
        status = "failed"
    rows[name] = {
        "status": status,
        "tag": tag,
        "digest": digest,
        "context": contexts.get(name, name),
        "target": targets.get(name, ""),
        "runtime_targets": runtime_targets.get(name, []),
        "evidence_refs": [tag, log_path],
    }

print(json.dumps(rows, sort_keys=True))
PY
}

write_report() {
  local status="$1"
  local exit_code="${2:-0}"
  local images_json
  local image_details_json
  images_json="$(printf '%s\n' $IMAGE_SET | python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')"
  if [[ "$status" == "passed" && "$exit_code" == "0" ]]; then
    image_details_json="$(images_report_json)"
  else
    image_details_json="$(python3 - "$IMAGE_PREFIX" "$GIT_SHA" "$LOG_PATH" "$IMAGE_SET" "$status" <<'PY'
import json
import sys

prefix = sys.argv[1]
git_sha = sys.argv[2]
log_path = sys.argv[3]
images = [item for item in sys.argv[4].split() if item]
status = sys.argv[5]
targets = {"backend": "", "web": "", "admin": ""}
contexts = {"backend": "backend", "web": "web", "admin": "admin"}
runtime_targets = {"backend": ["runtime-server", "runtime-worker"], "web": [], "admin": []}
print(json.dumps({
    name: {
        "status": status,
        "tag": f"{prefix}-{name}:{git_sha}",
        "digest": "",
        "context": contexts.get(name, name),
        "target": targets.get(name, ""),
        "runtime_targets": runtime_targets.get(name, []),
        "evidence_refs": [log_path],
    }
    for name in images
}, sort_keys=True))
PY
)"
  fi
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
  "runtime_targets": "$(printf '%s' "$RUNTIME_TARGETS")",
  "images": $image_details_json,
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
  local target=""
  if [[ "$name" != "backend" && "$name" != "web" && "$name" != "admin" ]]; then
    printf 'unsupported image name: %s\n' "$name" >&2
    return 64
  fi
  if [[ -n "$target" ]]; then
    docker build --target "$target" --tag "${IMAGE_PREFIX}-${name}:${GIT_SHA}" "$context"
    return
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
