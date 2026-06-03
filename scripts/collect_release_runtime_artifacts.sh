#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_ID="${RUN_ID:-}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-ops/evidence/runtime-inputs}"
CI_INPUT_DIR_EXPLICIT=0
STAGING_INPUT_DIR_EXPLICIT=0
PRODUCTION_INPUT_DIR_EXPLICIT=0
if [[ -n "${CI_INPUT_DIR:-}" ]]; then
  CI_INPUT_DIR_EXPLICIT=1
fi
if [[ -n "${STAGING_INPUT_DIR:-}" ]]; then
  STAGING_INPUT_DIR_EXPLICIT=1
fi
if [[ -n "${PRODUCTION_INPUT_DIR:-}" ]]; then
  PRODUCTION_INPUT_DIR_EXPLICIT=1
fi
CI_INPUT_DIR="${CI_INPUT_DIR:-$ARTIFACT_ROOT/ci}"
STAGING_INPUT_DIR="${STAGING_INPUT_DIR:-$ARTIFACT_ROOT/staging}"
PRODUCTION_INPUT_DIR="${PRODUCTION_INPUT_DIR:-$ARTIFACT_ROOT/production}"
DRY_RUN="${DRY_RUN:-1}"
COPY_RAW="${COPY_RAW:-0}"
CI_ARTIFACT_PATTERN="${CI_ARTIFACT_PATTERN:-stage0-rev2-ci-*-evidence}"

usage() {
  cat <<'EOF'
Usage: scripts/collect_release_runtime_artifacts.sh [options]

Collect Stage 0 Rev2 release runtime artifacts into canonical evidence inputs,
optionally downloading CI artifacts from a real GitHub Actions run.

Options:
  --run-id ID                 GitHub Actions run id to download CI evidence artifacts.
  --artifact-root DIR         Runtime input root. Default: ops/evidence/runtime-inputs
  --ci-input-dir DIR          CI artifact input directory.
  --staging-input-dir DIR     Staging artifact input directory.
  --production-input-dir DIR  Production artifact input directory.
  --ci-artifact-pattern GLOB  GitHub Actions artifact pattern. Default: stage0-rev2-ci-*-evidence
  --dry-run                   Validate/promote without writing canonical outputs. Default.
  --write                     Write canonical promoted evidence outputs.
  --copy-raw                  Copy validated raw source artifacts to raw/ audit directories.
  --help                      Show this help.

Environment variables with the same names remain supported:
RUN_ID, ARTIFACT_ROOT, CI_INPUT_DIR, STAGING_INPUT_DIR, PRODUCTION_INPUT_DIR,
CI_ARTIFACT_PATTERN, DRY_RUN, COPY_RAW.
EOF
}

block() {
  printf 'Release runtime artifact collection blocked: %s\n' "$*" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id)
      [[ $# -ge 2 ]] || block "--run-id requires a value"
      RUN_ID="$2"
      shift 2
      ;;
    --artifact-root)
      [[ $# -ge 2 ]] || block "--artifact-root requires a value"
      ARTIFACT_ROOT="$2"
      if [[ "$CI_INPUT_DIR_EXPLICIT" == "0" ]]; then
        CI_INPUT_DIR="$ARTIFACT_ROOT/ci"
      fi
      if [[ "$STAGING_INPUT_DIR_EXPLICIT" == "0" ]]; then
        STAGING_INPUT_DIR="$ARTIFACT_ROOT/staging"
      fi
      if [[ "$PRODUCTION_INPUT_DIR_EXPLICIT" == "0" ]]; then
        PRODUCTION_INPUT_DIR="$ARTIFACT_ROOT/production"
      fi
      shift 2
      ;;
    --ci-input-dir)
      [[ $# -ge 2 ]] || block "--ci-input-dir requires a value"
      CI_INPUT_DIR="$2"
      CI_INPUT_DIR_EXPLICIT=1
      shift 2
      ;;
    --staging-input-dir)
      [[ $# -ge 2 ]] || block "--staging-input-dir requires a value"
      STAGING_INPUT_DIR="$2"
      STAGING_INPUT_DIR_EXPLICIT=1
      shift 2
      ;;
    --production-input-dir)
      [[ $# -ge 2 ]] || block "--production-input-dir requires a value"
      PRODUCTION_INPUT_DIR="$2"
      PRODUCTION_INPUT_DIR_EXPLICIT=1
      shift 2
      ;;
    --ci-artifact-pattern)
      [[ $# -ge 2 ]] || block "--ci-artifact-pattern requires a value"
      CI_ARTIFACT_PATTERN="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --write)
      DRY_RUN=0
      shift
      ;;
    --copy-raw)
      COPY_RAW=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      block "unknown option: $1"
      ;;
  esac
done

mkdir -p "$CI_INPUT_DIR" "$STAGING_INPUT_DIR" "$PRODUCTION_INPUT_DIR"

if [[ -n "$RUN_ID" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    block "gh CLI is required when RUN_ID is set"
  fi
  if ! gh --version >/dev/null 2>&1; then
    block "gh CLI is installed but not executable"
  fi
  if ! gh auth status >/dev/null 2>&1; then
    block "gh auth status failed; authenticate GitHub CLI before downloading CI artifacts"
  fi
  if ! gh run download "$RUN_ID" \
    --dir "$CI_INPUT_DIR" \
    --pattern "$CI_ARTIFACT_PATTERN"; then
    block "gh run download failed for RUN_ID=$RUN_ID pattern=$CI_ARTIFACT_PATTERN"
  fi
fi

cmd=(
  python3 scripts/promote_release_runtime_artifacts.py
  --ci-input-dir "$CI_INPUT_DIR"
  --staging-input-dir "$STAGING_INPUT_DIR"
  --production-input-dir "$PRODUCTION_INPUT_DIR"
)

if [[ "$DRY_RUN" == "1" ]]; then
  cmd+=(--dry-run)
fi
if [[ "$COPY_RAW" == "1" ]]; then
  cmd+=(--copy-raw)
fi

"${cmd[@]}"
