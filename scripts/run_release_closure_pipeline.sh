#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARTIFACT_ROOT="${ARTIFACT_ROOT:-ops/evidence/runtime-inputs}"
CI_INPUT_DIR="${CI_INPUT_DIR:-$ARTIFACT_ROOT/ci}"
STAGING_INPUT_DIR="${STAGING_INPUT_DIR:-$ARTIFACT_ROOT/staging}"
PRODUCTION_INPUT_DIR="${PRODUCTION_INPUT_DIR:-$ARTIFACT_ROOT/production}"
RELEASE_OUT_DIR="${RELEASE_OUT_DIR:-ops/evidence/release}"
RUN_ID="${RUN_ID:-}"
CI_ARTIFACT_PATTERN="${CI_ARTIFACT_PATTERN:-stage0-rev2-ci-*-evidence}"
COPY_RAW="${COPY_RAW:-0}"
APPLY=0
DRY_RUN=1

usage() {
  cat <<'EOF'
Usage: scripts/run_release_closure_pipeline.sh [options]

Run the Stage 0 Rev2 release runtime closure pipeline:
collect/promote runtime artifacts, reconcile, plan fixture updates, plan
checklist closures, and render or apply the closure report.

Options:
  --run-id ID                 GitHub Actions run id for CI artifact download.
  --artifact-root DIR         Runtime input root. Default: ops/evidence/runtime-inputs
  --ci-input-dir DIR          CI artifact input directory.
  --staging-input-dir DIR     Staging artifact input directory.
  --production-input-dir DIR  Production artifact input directory.
  --release-out-dir DIR       Release report output directory. Default: ops/evidence/release
  --ci-artifact-pattern GLOB  GitHub Actions artifact pattern. Default: stage0-rev2-ci-*-evidence
  --copy-raw                  Copy validated source artifacts to raw/ audit directories.
  --dry-run                   Keep non-mutating mode. Default.
  --apply                     Write promoted evidence, apply pass-ready fixture/checklist plans, then validate.
  --help                      Show this help.
EOF
}

block() {
  printf 'Stage 0 Rev2 release closure pipeline blocked: %s\n' "$*" >&2
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
      CI_INPUT_DIR="$ARTIFACT_ROOT/ci"
      STAGING_INPUT_DIR="$ARTIFACT_ROOT/staging"
      PRODUCTION_INPUT_DIR="$ARTIFACT_ROOT/production"
      shift 2
      ;;
    --ci-input-dir)
      [[ $# -ge 2 ]] || block "--ci-input-dir requires a value"
      CI_INPUT_DIR="$2"
      shift 2
      ;;
    --staging-input-dir)
      [[ $# -ge 2 ]] || block "--staging-input-dir requires a value"
      STAGING_INPUT_DIR="$2"
      shift 2
      ;;
    --production-input-dir)
      [[ $# -ge 2 ]] || block "--production-input-dir requires a value"
      PRODUCTION_INPUT_DIR="$2"
      shift 2
      ;;
    --release-out-dir)
      [[ $# -ge 2 ]] || block "--release-out-dir requires a value"
      RELEASE_OUT_DIR="$2"
      shift 2
      ;;
    --ci-artifact-pattern)
      [[ $# -ge 2 ]] || block "--ci-artifact-pattern requires a value"
      CI_ARTIFACT_PATTERN="$2"
      shift 2
      ;;
    --copy-raw)
      COPY_RAW=1
      shift
      ;;
    --dry-run)
      APPLY=0
      DRY_RUN=1
      shift
      ;;
    --apply)
      APPLY=1
      DRY_RUN=0
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

mkdir -p "$RELEASE_OUT_DIR"

RUNTIME_RECONCILIATION="$RELEASE_OUT_DIR/runtime-reconciliation.json"
RUNTIME_INPUT_MANIFEST="$RELEASE_OUT_DIR/runtime-input-manifest.json"
RUNTIME_INPUT_WORKSPACE="$RELEASE_OUT_DIR/runtime-input-workspace.json"
FIXTURE_PLAN="$RELEASE_OUT_DIR/fixture-update-plan.json"
CHECKLIST_PLAN="$RELEASE_OUT_DIR/checklist-closure-plan.json"
APPLY_REPORT="$RELEASE_OUT_DIR/closure-apply-report.json"
PIPELINE_REPORT="$RELEASE_OUT_DIR/closure-pipeline-report.json"

collector_cmd=(
  scripts/collect_release_runtime_artifacts.sh
  --artifact-root "$ARTIFACT_ROOT"
  --ci-input-dir "$CI_INPUT_DIR"
  --staging-input-dir "$STAGING_INPUT_DIR"
  --production-input-dir "$PRODUCTION_INPUT_DIR"
  --ci-artifact-pattern "$CI_ARTIFACT_PATTERN"
)
if [[ -n "$RUN_ID" ]]; then
  collector_cmd+=(--run-id "$RUN_ID")
fi
if [[ "$DRY_RUN" == "1" ]]; then
  collector_cmd+=(--dry-run)
else
  collector_cmd+=(--write)
fi
if [[ "$COPY_RAW" == "1" ]]; then
  collector_cmd+=(--copy-raw)
fi

set +e
collector_output="$("${collector_cmd[@]}" 2>&1)"
collector_status=$?
set -e
printf '%s\n' "$collector_output"

if [[ "$APPLY" == "1" && "$collector_status" -ne 0 ]]; then
  block "collector/promoter failed in --apply mode with status=$collector_status"
fi

python3 scripts/reconcile_release_gate_runtime_evidence.py --out "$RUNTIME_RECONCILIATION"
python3 scripts/plan_release_runtime_inputs.py \
  --reconciliation "$RUNTIME_RECONCILIATION" \
  --out "$RUNTIME_INPUT_MANIFEST"
prepare_cmd=(
  python3 scripts/prepare_release_runtime_inputs.py
  --manifest "$RUNTIME_INPUT_MANIFEST"
  --artifact-root "$ARTIFACT_ROOT"
  --out "$RUNTIME_INPUT_WORKSPACE"
)
if [[ "$APPLY" == "1" ]]; then
  prepare_cmd+=(--apply)
fi
"${prepare_cmd[@]}"
python3 scripts/plan_release_gate_fixture_updates.py \
  --reconciliation "$RUNTIME_RECONCILIATION" \
  --out "$FIXTURE_PLAN"
python3 scripts/plan_stage0_rev2_checklist_closure.py \
  --fixture-plan "$FIXTURE_PLAN" \
  --out "$CHECKLIST_PLAN"

apply_cmd=(
  python3 scripts/apply_release_closure_plan.py
  --fixture-plan "$FIXTURE_PLAN"
  --checklist-plan "$CHECKLIST_PLAN"
  --out "$APPLY_REPORT"
)
if [[ "$APPLY" == "1" ]]; then
  apply_cmd+=(--apply)
fi
"${apply_cmd[@]}"

python3 - "$PIPELINE_REPORT" "$collector_status" "$APPLY" "$RUNTIME_RECONCILIATION" "$RUNTIME_INPUT_MANIFEST" "$RUNTIME_INPUT_WORKSPACE" "$FIXTURE_PLAN" "$CHECKLIST_PLAN" "$APPLY_REPORT" <<'PY'
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

out = Path(sys.argv[1])
collector_status = int(sys.argv[2])
applied = sys.argv[3] == "1"
runtime_reconciliation = Path(sys.argv[4])
runtime_input_manifest = Path(sys.argv[5])
runtime_input_workspace = Path(sys.argv[6])
fixture_plan = Path(sys.argv[7])
checklist_plan = Path(sys.argv[8])
apply_report = Path(sys.argv[9])

def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))

reconciliation = load(runtime_reconciliation)
manifest = load(runtime_input_manifest)
workspace = load(runtime_input_workspace)
fixture = load(fixture_plan)
checklist = load(checklist_plan)
apply_data = load(apply_report)
blocked_checks = reconciliation.get("blocked_checks", [])
report = {
    "schema_version": "stage0.rev2.release_closure_pipeline_report",
    "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "mode": "apply" if applied else "dry_run_non_mutating",
    "applied": applied,
    "collector_status": collector_status,
    "collector_policy": (
        "nonzero collector status is allowed in dry-run so reconciliation and closure plans still render"
        if not applied
        else "collector must pass before apply"
    ),
    "runtime_reconciliation": str(runtime_reconciliation),
    "runtime_input_manifest": str(runtime_input_manifest),
    "runtime_input_workspace": str(runtime_input_workspace),
    "fixture_update_plan": str(fixture_plan),
    "checklist_closure_plan": str(checklist_plan),
    "closure_apply_report": str(apply_report),
    "ready_checks": reconciliation.get("ready_checks", []),
    "blocked_checks": blocked_checks,
    "runtime_input_summary": manifest.get("summary", {}),
    "runtime_input_workspace_directory_count": workspace.get("planned_directory_count", 0),
    "planned_update_count": fixture.get("planned_update_count", 0),
    "planned_closure_count": checklist.get("planned_closure_count", 0),
    "apply_change_count": apply_data.get("change_count", 0),
}
out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2, sort_keys=True))
PY
