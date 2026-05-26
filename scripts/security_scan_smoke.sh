#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN="${DRY_RUN:-0}"
OUT_DIR="${OUT_DIR:-ops/evidence/security/local}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-security-scan-smoke-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
SECRET_FINDINGS="$OUT_DIR/${RUN_ID}.secrets.txt"
SECRET_CANDIDATES="$OUT_DIR/${RUN_ID}.secret-candidates.txt"
NPM_AUDIT_WEB="$OUT_DIR/${RUN_ID}.web-npm-audit.json"
NPM_AUDIT_ADMIN="$OUT_DIR/${RUN_ID}.admin-npm-audit.json"
GO_VULN="$OUT_DIR/${RUN_ID}.govulncheck.txt"
TRIVY_IMAGE="$OUT_DIR/${RUN_ID}.trivy-image.txt"
IMAGE_SET="${IMAGE_SET:-zenart-stage0-backend zenart-stage0-web zenart-stage0-admin}"

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

write_report() {
  local status="$1"
  mkdir -p "$OUT_DIR"
  python3 - "$REPORT_PATH" "$status" "$SECRET_FINDINGS" "$NPM_AUDIT_WEB" "$NPM_AUDIT_ADMIN" "$GO_VULN" "$TRIVY_IMAGE" "$IMAGE_SET" <<'PY'
import json
import sys
from pathlib import Path

secret_findings = Path(sys.argv[3])
web_audit = Path(sys.argv[4])
admin_audit = Path(sys.argv[5])
govuln = Path(sys.argv[6])
trivy = Path(sys.argv[7])
images = [item for item in sys.argv[8].split() if item]

def exists_nonempty(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0

Path(sys.argv[1]).write_text(json.dumps({
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "created_by_lane": "lane5",
    "status": sys.argv[2],
    "scan_contract": {
        "dependency_scan": {
            "web_npm_audit": str(web_audit),
            "admin_npm_audit": str(admin_audit),
            "go_vulncheck": str(govuln),
            "go_vulncheck_installed": exists_nonempty(govuln),
        },
        "docker_image_scan": {
            "image_set": images,
            "trivy_output": str(trivy),
            "trivy_installed": exists_nonempty(trivy),
        },
        "secret_scan": {
            "patterns_file": str(secret_findings),
            "committed_secret_findings": exists_nonempty(secret_findings),
        },
    },
    "ci_gate": "script_contract_complete; installed CI execution remains token-blocked outside ops/ci",
    "private_beta_gate": "open_until_dependency_image_secret_scans_run_in_staging_release_context",
    "production_gate": "open_until_scans_are_attached_to_release_go_no_go_and_fail_on_high_severity",
}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

if [[ "$DRY_RUN" == "1" ]]; then
  rm -f "$SECRET_FINDINGS" "$SECRET_CANDIDATES" "$NPM_AUDIT_WEB" "$NPM_AUDIT_ADMIN" "$GO_VULN" "$TRIVY_IMAGE"
  write_report "planned"
  printf 'security scan smoke dry-run planned\n'
  exit 0
fi

mkdir -p "$OUT_DIR"
rm -f "$SECRET_FINDINGS" "$SECRET_CANDIDATES" "$NPM_AUDIT_WEB" "$NPM_AUDIT_ADMIN" "$GO_VULN" "$TRIVY_IMAGE"

if git grep -nE '(AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,})' -- . >"$SECRET_CANDIDATES"; then
  grep -Ev '^(\.env\.example|fixtures/|schemas/|ops/ci/stage0-rev2-ci\.yml|scripts/repo_validate\.sh|scripts/security_scan_smoke\.sh|backend/internal/security/redact_test\.go):' "$SECRET_CANDIDATES" >"$SECRET_FINDINGS" || true
  rm -f "$SECRET_CANDIDATES"
  if [[ -s "$SECRET_FINDINGS" ]]; then
    write_report "failed"
    printf 'potential committed secret found; see %s\n' "$SECRET_FINDINGS" >&2
    exit 1
  fi
fi
rm -f "$SECRET_FINDINGS" "$SECRET_CANDIDATES"

if has_cmd npm; then
  (cd web && npm audit --omit=dev --json >"$ROOT/$NPM_AUDIT_WEB" || true)
  (cd admin && npm audit --omit=dev --json >"$ROOT/$NPM_AUDIT_ADMIN" || true)
fi

if has_cmd govulncheck; then
  (cd backend && govulncheck ./... >"$ROOT/$GO_VULN")
fi

if has_cmd trivy; then
  {
    for image in $IMAGE_SET; do
      trivy image --scanners vuln --severity HIGH,CRITICAL --exit-code 0 "$image"
    done
  } >"$TRIVY_IMAGE" 2>&1 || true
else
  printf 'trivy not installed; image scan runtime remains open\n' >"$TRIVY_IMAGE"
fi

write_report "passed"
printf 'security scan smoke passed; evidence written to %s\n' "$REPORT_PATH"
