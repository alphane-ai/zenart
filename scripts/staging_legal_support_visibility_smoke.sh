#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_URL="${WEB_URL:-${STAGING_WEB_URL:-}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}"
DRY_RUN="${DRY_RUN:-0}"
OUT_DIR_WAS_SET=0
if [[ -n "${OUT_DIR+x}" || -n "${REPORT_PATH+x}" || -n "${RESULTS_PATH+x}" ]]; then
  OUT_DIR_WAS_SET=1
fi
if [[ "$DRY_RUN" == "1" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/stage0-legal-support-dry-run.XXXXXX")"
else
  OUT_DIR="${OUT_DIR:-ops/evidence/staging}"
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${RUN_ID:-${STAMP}-legal-support-visibility-$$}"
REPORT_PATH="${REPORT_PATH:-$OUT_DIR/${RUN_ID}.json}"
RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/${RUN_ID}.ndjson}"
LEGAL_PAGES_REPORT_PATH="${LEGAL_PAGES_REPORT_PATH:-$OUT_DIR/legal-pages-external-user.json}"
SUPPORT_CONTACT_REPORT_PATH="${SUPPORT_CONTACT_REPORT_PATH:-$OUT_DIR/support-contact-external-user.json}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"

mkdir -p "$OUT_DIR"
: >"$RESULTS_PATH"

CHECKS=(
  "terms|legal_page|/legal/terms|Terms of Service,Support,Local Alpha Generation"
  "privacy|legal_page|/legal/privacy|Privacy Policy,Support Context,Telemetry"
  "acceptable_use|legal_page|/legal/acceptable-use|Acceptable Use Policy,Prohibited Inputs,Enforcement"
  "ip_complaint|legal_page|/legal/ip-complaints|IP Complaint Flow,legal@zenart.local,support@zenart.local"
  "ai_content_disclaimer|legal_page|/support|AI Content Responsibility,Acceptable Use Policy,Local alpha previews"
  "support_contact|support_contact|/support|support@zenart.local,Report Problem,Submit Ticket"
  "billing_policy|support_contact|/legal/billing-policy|Billing, Cancellation, and Refund Policy,support@zenart.local,Cancellation"
)

append_result() {
  local check_id="$1"
  local category="$2"
  local path="$3"
  local url="$4"
  local expected_tokens="$5"
  local status="$6"
  local http_status="$7"
  local reason="$8"
  python3 - "$RESULTS_PATH" "$check_id" "$category" "$path" "$url" "$expected_tokens" "$status" "$http_status" "$reason" <<'PY'
import json
import sys

result_path, check_id, category, path, url, expected_tokens, status, http_status, reason = sys.argv[1:]
with open(result_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "check_id": check_id,
        "category": category,
        "path": path,
        "url": url,
        "expected_tokens": [token.strip() for token in expected_tokens.split(",") if token.strip()],
        "status": status,
        "http_status": int(http_status) if http_status.isdigit() else None,
        "reason": reason,
    }, sort_keys=True) + "\n")
PY
}

if [[ -z "$WEB_URL" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id category path expected_tokens <<<"$check"
    append_result "$check_id" "$category" "$path" "" "$expected_tokens" "blocked" "" "missing_staging_web_url"
  done
elif [[ "$DRY_RUN" == "1" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id category path expected_tokens <<<"$check"
    append_result "$check_id" "$category" "$path" "${WEB_URL%/}$path" "$expected_tokens" "planned" "" "dry_run_no_external_user_probe"
  done
else
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id category path expected_tokens <<<"$check"
    url="${WEB_URL%/}$path"
    body_file="$(mktemp)"
    http_status="$(
      curl \
        --silent \
        --show-error \
        --location \
        --max-time "$TIMEOUT_SECONDS" \
        --output "$body_file" \
        --write-out "%{http_code}" \
        "$url" || true
    )"
    if [[ "$http_status" != "200" ]]; then
      append_result "$check_id" "$category" "$path" "$url" "$expected_tokens" "failed" "$http_status" "unexpected_http_status"
      rm -f "$body_file"
      continue
    fi
    missing_tokens=()
    IFS=',' read -r -a tokens <<<"$expected_tokens"
    for token in "${tokens[@]}"; do
      if ! grep -Fqi "$token" "$body_file"; then
        missing_tokens+=("$token")
      fi
    done
    rm -f "$body_file"
    if [[ "${#missing_tokens[@]}" -gt 0 ]]; then
      append_result "$check_id" "$category" "$path" "$url" "$expected_tokens" "failed" "$http_status" "missing_tokens:${missing_tokens[*]}"
    else
      append_result "$check_id" "$category" "$path" "$url" "$expected_tokens" "passed" "$http_status" "ok"
    fi
  done
fi

python3 - "$REPORT_PATH" "$RESULTS_PATH" "$RUN_ID" "$RELEASE_SHA" "$WEB_URL" "$LEGAL_PAGES_REPORT_PATH" "$SUPPORT_CONTACT_REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
run_id = sys.argv[3]
release_sha = sys.argv[4].strip()
web_url = sys.argv[5].strip()
legal_pages_report_path = Path(sys.argv[6])
support_contact_report_path = Path(sys.argv[7])

results = [
    json.loads(line)
    for line in results_path.read_text(encoding="utf-8").splitlines()
    if line.strip()
]

required_legal = {
    "terms",
    "privacy",
    "acceptable_use",
    "ip_complaint",
    "ai_content_disclaimer",
}
required_support = {
    "support_contact",
    "billing_policy",
}
passed = {item["check_id"] for item in results if item["status"] == "passed"}
blocked_or_failed = [
    f"{item['check_id']}:{item['reason']}"
    for item in results
    if item["status"] != "passed"
]
all_passed = required_legal | required_support <= passed and not blocked_or_failed
status = "pass" if all_passed else "blocked"
probe_contract = {
    "schema_version": "stage0.rev2.staging.probe_contract",
    "contract_id": "legal_support_external_user_visibility_runtime_probe",
    "environment": "staging",
    "release_gate_check_id": "staging_legal_external_user_pages",
    "do_not_launch_condition_id": "external_user_legal_pages_missing",
    "canonical_legal_pages_report": str(legal_pages_report_path),
    "canonical_support_contact_report": str(support_contact_report_path),
    "results_path": str(results_path),
    "blocked_without_runtime_inputs": True,
    "local_blocked_command": "DRY_RUN=1 scripts/staging_legal_support_visibility_smoke.sh || test \"$?\" = 2",
    "staging_pass_command": "STAGING_WEB_URL=https://<staging-web> scripts/staging_legal_support_visibility_smoke.sh",
    "required_env": [
        "STAGING_WEB_URL or WEB_URL",
    ],
    "required_routes": [
        "/legal/terms",
        "/legal/privacy",
        "/legal/acceptable-use",
        "/legal/ip-complaints",
        "/support",
        "/legal/billing-policy",
    ],
    "success_criteria": [
        "all required external-user routes return HTTP 200",
        "legal pages expose Terms, Privacy, Acceptable Use, AI/content disclaimer, and IP complaint tokens",
        "support routes expose support contact, report-problem, and billing/support policy tokens",
        "canonical split reports are written under ops/evidence/staging/",
    ],
}
legal_pages_passed = required_legal <= passed and not [
    item for item in results if item["check_id"] in required_legal and item["status"] != "passed"
]
support_contact_passed = required_support <= passed and not [
    item for item in results if item["check_id"] in required_support and item["status"] != "passed"
]

def coverage_item(area, check_ids, summary):
    evidence_refs = [str(results_path), str(report_path)]
    related = [item for item in results if item["check_id"] in check_ids]
    return {
        "area": area,
        "status": "pass" if all(item["status"] == "passed" for item in related) else "blocked",
        "runtime_probe": summary,
        "external_user_evidence": "Staging external-user HTTP visibility probe over deployed web routes; source files alone do not satisfy this check.",
        "evidence_path_policy": "ops/evidence/staging/",
        "evidence_refs": evidence_refs,
        "routes": [item["path"] for item in related],
        "expected_tokens": sorted({token for item in related for token in item["expected_tokens"]}),
    }

report = {
    "schema_version": "stage0.rev2.staging.legal_support_visibility",
    "evidence_id": run_id,
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "environment": "staging",
    "kind": "legal_support_visibility",
    "status": status,
    "release_sha": release_sha,
    "web_url": web_url,
    "validated_by_role": "external_user_smoke",
    "release_gate_check_id": "staging_legal_external_user_pages",
    "do_not_launch_condition_id": "external_user_legal_pages_missing",
    "results_path": str(results_path),
    "probe_contract": probe_contract,
    "required_routes": [
        "/legal/terms",
        "/legal/privacy",
        "/legal/acceptable-use",
        "/legal/ip-complaints",
        "/support",
        "/legal/billing-policy",
    ],
    "runtime_input_requirements": {
        "required_web_url": "STAGING_WEB_URL or WEB_URL pointing at the deployed staging web surface",
        "required_probe_mode": "external-user HTTP GET probes must load deployed routes; DRY_RUN only records blocked/planned evidence",
        "required_routes": {
            "terms": "/legal/terms",
            "privacy": "/legal/privacy",
            "acceptable_use": "/legal/acceptable-use",
            "ip_complaint": "/legal/ip-complaints",
            "ai_content_disclaimer": "/support",
            "support_contact": "/support",
            "billing_policy": "/legal/billing-policy",
        },
        "required_exact_split_reports": {
            "legal_pages_external_user": str(legal_pages_report_path),
            "support_contact_external_user": str(support_contact_report_path),
        },
        "source_file_policy": "web source files or checked-in policy text alone cannot satisfy staging legal/support visibility; the pass report requires deployed external-user HTTP probe results.",
    },
    "input_readiness": {
        "web_url_ready": bool(web_url),
        "dry_run": any(item["status"] == "planned" for item in results),
        "external_probe_attempted": bool(web_url) and not any(item["status"] == "planned" for item in results),
        "legal_pages_split_ready": legal_pages_passed,
        "support_contact_split_ready": support_contact_passed,
    },
    "coverage": [
        coverage_item(
            "legal_pages_visibility",
            required_legal,
            "External-user staging probe verifies Terms, Privacy, Acceptable Use, AI/content responsibility disclaimer, and IP complaint flow visibility.",
        ),
        coverage_item(
            "support_contact_visibility",
            required_support,
            "External-user staging probe verifies visible support contact, report-problem path, and support/billing policy visibility.",
        ),
    ],
    "blocked_checks": blocked_or_failed,
    "gate_impact": {
        "check_level_items": [
            "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。",
            "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
            "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。",
        ],
        "can_clear_release_gate_check": all_passed,
        "remaining_release_gate_blockers_after_pass": [
            "staging_object_storage_signed_downloads",
        ],
        "can_clear_aggregate_item": False,
        "preserved_release_gate_check_id": "staging_object_storage_signed_downloads",
        "preserved_do_not_launch_condition_id": "object_storage_signed_retention_runtime_missing",
    },
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

def write_split_report(path: Path, *, split_id: str, kind: str, checklist_item: str, area: str, check_ids: set[str], summary: str) -> None:
    related = [item for item in results if item["check_id"] in check_ids]
    split = {
        "schema_version": "stage0.rev2.staging.legal_support_visibility.split",
        "evidence_id": split_id,
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "environment": "staging",
        "kind": kind,
        "status": "pass",
        "release_sha": release_sha,
        "web_url": web_url,
        "validated_by_role": "external_user_smoke",
        "release_gate_check_id": "staging_legal_external_user_pages",
        "do_not_launch_condition_id": "external_user_legal_pages_missing",
        "source_results_path": str(results_path),
        "source_report_path": str(report_path),
        "probe_contract": probe_contract,
        "runtime_input_requirements": {
            "required_web_url": "STAGING_WEB_URL or WEB_URL pointing at the deployed staging web surface",
            "source_file_policy": "web source files or checked-in policy text alone cannot satisfy this split; source_results must come from deployed external-user HTTP probes.",
            "source_results_path": str(results_path),
        },
        "coverage": [
            {
                "area": area,
                "status": "pass",
                "runtime_probe": summary,
                "external_user_evidence": "Staging external-user HTTP visibility probe over deployed web routes; source files alone do not satisfy this check.",
                "evidence_path_policy": "ops/evidence/staging/",
                "routes": [item["path"] for item in related],
                "expected_tokens": sorted({token for item in related for token in item["expected_tokens"]}),
                "source_results": related,
            }
        ],
        "gate_impact": {
            "check_level_item": checklist_item,
            "can_clear_check_level_item": True,
            "can_clear_release_gate_check": False,
            "aggregate_private_beta_gate_status": "blocked_by_other_staging_runtime_items",
        },
    }
    path.write_text(json.dumps(split, indent=2, sort_keys=True) + "\n", encoding="utf-8")

if legal_pages_passed:
    write_split_report(
        legal_pages_report_path,
        split_id="legal-pages-external-user",
        kind="legal_pages_external_user_visibility",
        checklist_item="Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
        area="legal_pages_visibility",
        check_ids=required_legal,
        summary="External user staging legal pages probe verifies Terms, Privacy, Acceptable Use, AI/content responsibility disclaimer, and IP complaint flow visibility.",
    )
if support_contact_passed:
    write_split_report(
        support_contact_report_path,
        split_id="support-contact-external-user",
        kind="support_contact_external_user_visibility",
        checklist_item="Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。",
        area="support_contact_visibility",
        check_ids=required_support,
        summary="External user staging support contact probe verifies visible support contact, report-problem path, and support/billing policy visibility.",
    )

if all_passed:
    print(f"staging legal/support visibility passed; evidence written to {report_path}")
else:
    print(f"staging legal/support visibility blocked; evidence written to {report_path}")
PY

python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(0 if report["status"] == "pass" else 2)
PY
