#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN="${DRY_RUN:-0}"
OUT_DIR="${OUT_DIR:-ops/evidence/security/local}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
EVIDENCE_ENVIRONMENT="${EVIDENCE_ENVIRONMENT:-${ENVIRONMENT:-local}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-security-scan-smoke-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
SECRET_FINDINGS="$OUT_DIR/${RUN_ID}.secrets.txt"
SECRET_CANDIDATES="$OUT_DIR/${RUN_ID}.secret-candidates.txt"
NPM_AUDIT_WEB="$OUT_DIR/${RUN_ID}.web-npm-audit.json"
NPM_AUDIT_ADMIN="$OUT_DIR/${RUN_ID}.admin-npm-audit.json"
GO_VULN="$OUT_DIR/${RUN_ID}.govulncheck.txt"
TRIVY_IMAGE="$OUT_DIR/${RUN_ID}.trivy-image.txt"
RELEASE_IMAGE_SET="${RELEASE_IMAGE_SET:-zenari-stage0-backend zenari-stage0-web zenari-stage0-admin}"
IMAGE_SET="${IMAGE_SET:-zenari-stage0-backend:local-security-scan zenari-stage0-web:local-security-scan zenari-stage0-admin:local-security-scan}"
TRIVY_SKIP_DB_UPDATE="${TRIVY_SKIP_DB_UPDATE:-1}"
TRIVY_SKIP_JAVA_DB_UPDATE="${TRIVY_SKIP_JAVA_DB_UPDATE:-1}"
TRIVY_DB_REPOSITORIES="${TRIVY_DB_REPOSITORIES:-ghcr.io/aquasecurity/trivy-db:2 mirror.gcr.io/aquasec/trivy-db:2}"
SECRET_PATTERN='(^|[^A-Za-z0-9_-])(AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|LLM_OPENAI_API_KEY|ZAI_API_KEY)[[:space:]]*[:=][[:space:]]*["'\''"]?[A-Za-z0-9._~+/=-]{16,}|(^|[^A-Za-z0-9_-])sk-(proj-)?[A-Za-z0-9_-]{20,}|(^|[^A-Za-z0-9_-])[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|(^|[^A-Za-z0-9_-])(sk|rk)_(live|test)_[A-Za-z0-9]{16,}|(^|[^A-Za-z0-9_-])pk_(live|test)_[A-Za-z0-9]{16,}|(^|[^A-Za-z0-9_-])whsec_[A-Za-z0-9]{16,}|(^|[^A-Za-z0-9_])ghp_[A-Za-z0-9_]{20,}'

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

artifact_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$ROOT" "$1" ;;
  esac
}

write_report() {
  local status="$1"
  mkdir -p "$OUT_DIR"
  python3 - "$REPORT_PATH" "$status" "$SECRET_FINDINGS" "$NPM_AUDIT_WEB" "$NPM_AUDIT_ADMIN" "$GO_VULN" "$TRIVY_IMAGE" "$RELEASE_IMAGE_SET" "$IMAGE_SET" "$RELEASE_SHA" "$EVIDENCE_ENVIRONMENT" "$TRIVY_SKIP_DB_UPDATE" "$TRIVY_SKIP_JAVA_DB_UPDATE" "$TRIVY_DB_REPOSITORIES" <<'PY'
import json
import re
import sys
from pathlib import Path

secret_findings = Path(sys.argv[3])
web_audit = Path(sys.argv[4])
admin_audit = Path(sys.argv[5])
govuln = Path(sys.argv[6])
trivy = Path(sys.argv[7])
release_images = [item for item in sys.argv[8].split() if item]
scanned_images = [item for item in sys.argv[9].split() if item]
release_sha = sys.argv[10]
environment = sys.argv[11]
trivy_skip_db_update = sys.argv[12] == "1"
trivy_skip_java_db_update = sys.argv[13] == "1"
trivy_db_repositories = [item for item in sys.argv[14].split() if item]

def exists_nonempty(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0

npm_audits = {
    "web": web_audit,
    "admin": admin_audit,
}
npm_audit_files_exist = {name: path.exists() for name, path in npm_audits.items()}
trivy_text = trivy.read_text(encoding="utf-8", errors="replace") if trivy.exists() else ""
db_version = ""
db_updated_at = ""
db_downloaded_at = ""
for line in trivy_text.splitlines():
    if "Trivy DB metadata:" not in line:
        continue
    version_match = re.search(r"Version:\s*([^;]+)", line)
    updated_match = re.search(r"UpdatedAt:\s*([^;]+)", line)
    downloaded_match = re.search(r"DownloadedAt:\s*(.+)$", line)
    if version_match:
        db_version = version_match.group(1).strip()
    if updated_match:
        db_updated_at = updated_match.group(1).strip()
    if downloaded_match:
        db_downloaded_at = downloaded_match.group(1).strip()
    break

Path(sys.argv[1]).write_text(json.dumps({
    "blueprint_source": "Docs/Stage1_20260621_blueprint.md",
    "blueprint_items": ["BE-2", "BE-11", "QA-8", "OP-13"],
    "created_by_lane": "lane5",
    "created_at": Path(sys.argv[1]).name.split("-security-scan-smoke-")[0],
    "run_id": Path(sys.argv[1]).stem,
    "kind": "security_scan",
    "environment": environment,
    "release_sha": release_sha,
    "status": sys.argv[2],
    "checks": [
        {
            "check_id": "dependency_scan",
            "status": "passed" if sys.argv[2] == "passed" and all(npm_audit_files_exist.values()) else "open",
            "evidence_refs": [str(web_audit), str(admin_audit), str(govuln)],
        },
        {
            "check_id": "image_scan",
            "status": "passed" if sys.argv[2] == "passed" and trivy.exists() and "trivy not installed" not in trivy.read_text(encoding="utf-8", errors="replace") else "open",
            "evidence_refs": [str(trivy)],
        },
        {
            "check_id": "secret_scan",
            "status": "passed" if sys.argv[2] == "passed" and not exists_nonempty(secret_findings) else "open",
            "evidence_refs": [str(secret_findings), "scripts/security_scan_smoke.sh"],
        },
    ],
    "stage1_secret_scan_patterns": {
        "openai_key_shape": "sk-(proj-)?[A-Za-z0-9_-]{20,}",
        "zai_key_shape": "[0-9a-f]{32}.[A-Za-z0-9_-]{16,}",
        "stripe_key_shape": "(sk|rk)_(live|test)_[A-Za-z0-9]{16,}",
        "stripe_publishable_key_shape": "pk_(live|test)_[A-Za-z0-9]{16,}",
        "stripe_webhook_secret_shape": "whsec_[A-Za-z0-9]{16,}",
        "github_token_shape": "ghp_[A-Za-z0-9_]{20,}",
    },
    "stage1_security_coverage": {
        "provider": "OpenAI-compatible provider, provider registry, edit adapter, and video adapter secret containment",
        "stripe": "Stripe checkout, portal, cancel, invoice, webhook signature, live/test separation, and lifecycle reconciliation projections",
        "batch": "Batch child execution, provider failure redaction, result sink trace projection, and raw provider payload persistence flags",
        "assets": "Visual asset storage refs, lineage, signed URL rejection, and raw payload persistence rejection",
        "support": "Support ticket body, metadata, and linked evidence redaction",
        "export": "Export manifest/render gates, safe object keys, trace provenance, and fail-closed download projection",
        "trace": "Trace user/export projection forbids raw prompt, provider payload, raw safety payload, and secret fields",
        "rate_limit": "Rate-limit and spend-cap evidence preserves raw_secret_projection=false",
        "toolchain": "backend Go and Docker builds pin to Go 1.26.4 so govulncheck uses a patched standard library for called-symbol checks",
    },
    "scan_contract": {
        "dependency_scan": {
            "npm_audit_level": "moderate",
            "required_npm_audit_projects": ["web", "admin"],
            "web_npm_audit": str(web_audit),
            "admin_npm_audit": str(admin_audit),
            "npm_audit_files_exist": npm_audit_files_exist,
            "go_vulncheck": str(govuln),
            "go_vulncheck_installed": exists_nonempty(govuln),
        },
        "docker_image_scan": {
            "image_set": release_images,
            "required_image_set": ["zenari-stage0-backend", "zenari-stage0-web", "zenari-stage0-admin"],
            "scanned_images": scanned_images,
            "trivy_output": str(trivy),
            "trivy_installed": exists_nonempty(trivy),
            "trivy_skip_db_update": trivy_skip_db_update,
            "trivy_skip_java_db_update": trivy_skip_java_db_update,
            "trivy_db_repositories": trivy_db_repositories,
            "trivy_db_version": db_version,
            "trivy_db_updated_at": db_updated_at,
            "trivy_db_downloaded_at": db_downloaded_at,
        },
        "secret_scan": {
            "patterns_file": str(secret_findings),
            "pattern_ids": [
                "openai_key_shape",
                "zai_key_shape",
                "stripe_key_shape",
                "stripe_publishable_key_shape",
                "stripe_webhook_secret_shape",
                "github_token_shape",
            ],
            "allowlisted_test_fixture_paths": [
                "backend/internal/billing/billing_test.go",
                "backend/internal/billing/stripe_checkout_test.go",
                "backend/internal/billing/stripe_webhook_test.go",
                "backend/internal/config/config_test.go",
                "backend/internal/security/redact_test.go",
                "backend/internal/server/server_test.go",
                "backend/internal/stage0/services_test.go",
            ],
            "committed_secret_findings": exists_nonempty(secret_findings),
        },
    },
    "ci_gate": "script_contract_complete; installed CI execution remains token-blocked outside ops/ci",
    "private_beta_gate": "open_until_dependency_image_secret_scans_run_in_staging_release_context",
    "production_gate": "open_until_production_release_security_launch_checks_attach_strict_secret_rbac_csrf_csp_rate_limit_provider_stripe_evidence",
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

if git grep -nE "$SECRET_PATTERN" -- . >"$SECRET_CANDIDATES"; then
  grep -Ev '^(\.env\.example|fixtures/.*|schemas/.*|ops/ci/stage0-rev2-ci\.yml|scripts/repo_validate\.sh|scripts/security_scan_smoke\.sh|scripts/validate_stage1_.*\.py|backend/internal/security/redact_test\.go):|^backend/internal/(billing/billing_test\.go|config/config_test\.go|server/server_test\.go|stage0/services_test\.go):[0-9]+:.*(sk|rk|pk)_(live|test)_[A-Za-z0-9_]+|^backend/internal/(billing/billing_test\.go|config/config_test\.go|server/server_test\.go|stage0/services_test\.go):[0-9]+:.*whsec_[A-Za-z0-9_]+|^backend/internal/server/server_test\.go:[0-9]+:.*sk-proj-[A-Za-z0-9_-]+|^backend/internal/stage0/services_test\.go:[0-9]+:.*sk-ant-[A-Za-z0-9_-]+|^backend/internal/provider/openai_compatible_test\.go:[0-9]+:.*sk-proj-[A-Za-z0-9_-]+' "$SECRET_CANDIDATES" >"$SECRET_FINDINGS" || true
  rm -f "$SECRET_CANDIDATES"
  if [[ -s "$SECRET_FINDINGS" ]]; then
    write_report "failed"
    printf 'potential committed secret found; see %s\n' "$SECRET_FINDINGS" >&2
    exit 1
  fi
fi
rm -f "$SECRET_FINDINGS" "$SECRET_CANDIDATES"

if has_cmd npm; then
  (cd web && npm audit --audit-level=moderate --json >"$(artifact_path "$NPM_AUDIT_WEB")") || true
  (cd admin && npm audit --audit-level=moderate --json >"$(artifact_path "$NPM_AUDIT_ADMIN")") || true
  if ! python3 - "$NPM_AUDIT_WEB" "$NPM_AUDIT_ADMIN" <<'PY'
import json
import sys
from pathlib import Path

failed = []
for name, raw_path in zip(("web", "admin"), sys.argv[1:]):
    path = Path(raw_path)
    if not path.exists():
        failed.append(f"{name}:missing npm audit report")
        continue
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        failed.append(f"{name}:invalid npm audit JSON: {exc}")
        continue
    vulnerabilities = data.get("metadata", {}).get("vulnerabilities")
    if not isinstance(vulnerabilities, dict):
        failed.append(f"{name}:missing npm audit vulnerability metadata")
        continue
    for severity in ("moderate", "high", "critical"):
        count = vulnerabilities.get(severity, 0)
        if isinstance(count, int) and count > 0:
            failed.append(f"{name}:{severity}={count}")
if failed:
    print("npm audit moderate+ vulnerabilities found: " + ", ".join(failed), file=sys.stderr)
    raise SystemExit(1)
PY
  then
    write_report "failed"
    printf 'npm audit moderate+ dependency scan failed; see %s and %s\n' "$NPM_AUDIT_WEB" "$NPM_AUDIT_ADMIN" >&2
    exit 1
  fi
else
  write_report "failed"
  printf 'npm is required for web/admin dependency audit gate\n' >&2
  exit 1
fi

if has_cmd govulncheck; then
  if ! (cd backend && govulncheck ./... >"$(artifact_path "$GO_VULN")"); then
    write_report "failed"
    printf 'govulncheck dependency scan failed; see %s\n' "$GO_VULN" >&2
    exit 1
  fi
fi

if has_cmd trivy; then
  {
    printf 'Trivy version:\n'
    trivy --version || true
    printf '\nTrivy DB metadata: '
    trivy --version | awk '
      /^  Version:/ { version=$2 }
      /^  UpdatedAt:/ { updated=substr($0, index($0,$2)) }
      /^  DownloadedAt:/ { downloaded=substr($0, index($0,$2)) }
      END { printf "Version: %s; UpdatedAt: %s; DownloadedAt: %s\n", version, updated, downloaded }
    '
  } >>"$TRIVY_IMAGE" 2>&1
  trivy_db_args=()
  if [[ "$TRIVY_SKIP_DB_UPDATE" == "1" ]]; then
    trivy_db_args+=(--skip-db-update)
  else
    for repo in $TRIVY_DB_REPOSITORIES; do
      trivy_db_args+=(--db-repository "$repo")
    done
  fi
  if [[ "$TRIVY_SKIP_JAVA_DB_UPDATE" == "1" ]]; then
    trivy_db_args+=(--skip-java-db-update)
  fi
  for image in $IMAGE_SET; do
    if ! trivy image "${trivy_db_args[@]}" --scanners vuln --severity HIGH,CRITICAL --exit-code 1 "$image" >>"$TRIVY_IMAGE" 2>&1; then
      write_report "failed"
      printf 'trivy image scan failed or could not download its vulnerability DB; see %s\n' "$TRIVY_IMAGE" >&2
      exit 1
    fi
  done
else
  printf 'trivy not installed; image scan runtime remains open\n' >"$TRIVY_IMAGE"
fi

if grep -Eq 'Total: [1-9][0-9]* \(HIGH: [1-9][0-9]*, CRITICAL: [0-9]+\)|Total: [1-9][0-9]* \(HIGH: [0-9]+, CRITICAL: [1-9][0-9]*\)|HIGH: [1-9][0-9]*|CRITICAL: [1-9][0-9]*' "$TRIVY_IMAGE"; then
  write_report "failed"
  printf 'trivy high/critical image scan failed; see %s\n' "$TRIVY_IMAGE" >&2
  exit 1
fi

write_report "passed"
printf 'security scan smoke passed; evidence written to %s\n' "$REPORT_PATH"
