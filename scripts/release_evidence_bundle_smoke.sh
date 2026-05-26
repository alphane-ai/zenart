#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-ops/evidence/release/staging}"
DRY_RUN="${DRY_RUN:-1}"
STAGING_OUT_DIR="$(mktemp -d)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-release-evidence-bundle-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"

mkdir -p "$OUT_DIR"

set +e
DRY_RUN="$DRY_RUN" OUT_DIR="$STAGING_OUT_DIR" scripts/staging_smoke.sh >/dev/null
status=$?
set -e

staging_report="$(find "$STAGING_OUT_DIR" -maxdepth 1 -type f -name '*.json' | sort | tail -n 1)"
if [[ -z "$staging_report" ]]; then
  printf 'staging smoke did not produce a report\n' >&2
  exit 1
fi

python3 - "$REPORT_PATH" "$staging_report" "$status" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
staging_report_path = Path(sys.argv[2])
staging_exit_code = int(sys.argv[3])
staging = json.loads(staging_report_path.read_text(encoding="utf-8"))
summary = staging.get("summary", {})
release_evidence = summary.get("release_evidence", {})
go_no_go = summary.get("go_no_go", {})
verification = release_evidence.get("local_evidence_verification", {})

slots = []
for slot, required in sorted(release_evidence.get("required_slots", {}).items()):
    verifier = verification.get(slot)
    slots.append(
        {
            "slot": slot,
            "provided": bool(required),
            "verified": bool(verifier.get("verified")) if isinstance(verifier, dict) else bool(required),
            "reason": verifier.get("reason") if isinstance(verifier, dict) else None,
        }
    )

missing_slots = [slot["slot"] for slot in slots if not slot["provided"]]
unverified_slots = [slot["slot"] for slot in slots if not slot["verified"]]
decision = go_no_go.get("decision", "no-go")
status = "passed" if staging_exit_code == 0 and decision == "go" else "blocked"

report_path.write_text(
    json.dumps(
        {
            "blueprint_source": "Docs/stage0_blueprint_rev2.md",
            "created_by_lane": "lane5",
            "created_at": report_path.name.split("-release-evidence-bundle-")[0],
            "run_id": report_path.stem,
            "kind": "release_evidence_bundle",
            "environment": staging.get("environment", "staging"),
            "release_sha": staging.get("release_sha", ""),
            "status": status,
            "decision": decision,
            "source_staging_smoke_report": str(staging_report_path),
            "staging_smoke_exit_code": staging_exit_code,
            "release_evidence_complete": go_no_go.get("release_evidence_complete") is True,
            "post_deploy_smoke_verified": go_no_go.get("post_deploy_smoke_verified") is True,
            "gate_fixtures_clear": go_no_go.get("gate_fixtures_clear") is True,
            "missing_slots": missing_slots,
            "unverified_slots": unverified_slots,
            "slots": slots,
            "blocking_reasons": go_no_go.get("blocking_reasons", []),
            "private_beta_gate": "open_until_release_evidence_bundle_status_passed_and_private_beta_fixture_clear",
            "production_gate": "open_until_ci_private_beta_and_production_release_evidence_bundles_pass",
        },
        indent=2,
        sort_keys=True,
    )
    + "\n",
    encoding="utf-8",
)
PY

if [[ "$status" -ne 0 ]]; then
  printf 'release evidence bundle blocked; evidence written to %s\n' "$REPORT_PATH" >&2
  exit "$status"
fi

decision="$(python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("decision", "no-go"))
PY
)"
if [[ "$decision" != "go" ]]; then
  printf 'release evidence bundle remains no-go; evidence written to %s\n' "$REPORT_PATH" >&2
  exit 2
fi

printf 'release evidence bundle passed; evidence written to %s\n' "$REPORT_PATH"
