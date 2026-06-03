#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_URL="${WEB_URL:-${STAGING_WEB_URL:-}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}"
DRY_RUN="${DRY_RUN:-0}"
OUT_DIR="${OUT_DIR:-ops/evidence/staging}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${RUN_ID:-${STAMP}-legal-support-visibility-$$}"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
RESULTS_PATH="$OUT_DIR/${RUN_ID}.ndjson"
LEGAL_REPORT_PATH="${LEGAL_REPORT_PATH:-$OUT_DIR/legal-pages-external-user.json}"
SUPPORT_REPORT_PATH="${SUPPORT_REPORT_PATH:-$OUT_DIR/support-contact-external-user.json}"
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

python3 - "$REPORT_PATH" "$RESULTS_PATH" "$RUN_ID" "$RELEASE_SHA" "$WEB_URL" "$LEGAL_REPORT_PATH" "$SUPPORT_REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
run_id = sys.argv[3]
release_sha = sys.argv[4].strip()
web_url = sys.argv[5].strip()
legal_report_path = Path(sys.argv[6])
support_report_path = Path(sys.argv[7])

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

def split_report(evidence_id, kind, check_ids, status, coverage_area, check_level_item, extra_tokens):
    related = [item for item in results if item["check_id"] in check_ids]
    return {
        "schema_version": "stage0.rev2.staging.legal_support_visibility",
        "evidence_id": evidence_id,
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "environment": "staging",
        "kind": kind,
        "status": status,
        "release_sha": release_sha,
        "web_url": web_url,
        "validated_by_role": "external_user_smoke",
        "release_gate_check_id": "staging_legal_external_user_pages",
        "do_not_launch_condition_id": "external_user_legal_pages_missing",
        "results_path": str(results_path),
        "coverage": [
            {
                "area": coverage_area,
                "status": status,
                "runtime_probe": "External-user staging HTTP visibility probe verified deployed routes and visible copy; web source files alone do not satisfy this check.",
                "external_user_evidence": "external user visibility probe",
                "routes": [item["path"] for item in related],
                "expected_tokens": sorted({token for item in related for token in item["expected_tokens"]} | set(extra_tokens)),
                "evidence_refs": [str(results_path), str(report_path)],
                "results": related,
            }
        ],
        "blocked_checks": [
            f"{item['check_id']}:{item['reason']}"
            for item in related
            if item["status"] != "passed"
        ],
        "gate_impact": {
            "check_level_item": check_level_item,
            "can_clear_check_level_item": status == "pass",
            "can_clear_release_gate_check": False,
            "aggregate_private_beta_gate_status": "blocked_until_legal_and_support_split_evidence_are_both_cited",
        },
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
    "required_routes": [
        "/legal/terms",
        "/legal/privacy",
        "/legal/acceptable-use",
        "/legal/ip-complaints",
        "/support",
        "/legal/billing-policy",
    ],
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
legal_status = "pass" if required_legal <= passed and not any(item["status"] != "passed" for item in results if item["check_id"] in required_legal) else "blocked"
support_status = "pass" if required_support <= passed and not any(item["status"] != "passed" for item in results if item["check_id"] in required_support) else "blocked"
legal_report = split_report(
    run_id + "-legal-pages",
    "legal_pages_external_user_visibility",
    required_legal,
    legal_status,
    "legal_pages_visibility",
    "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
    ["terms", "privacy", "acceptable use", "ai/content", "ip complaint", "external user"],
)
support_report = split_report(
    run_id + "-support-contact",
    "support_contact_external_user_visibility",
    required_support,
    support_status,
    "support_contact_visibility",
    "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。",
    ["support", "report-problem", "external user"],
)
legal_report_path.write_text(json.dumps(legal_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
support_report_path.write_text(json.dumps(support_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
if all_passed:
    print(f"staging legal/support visibility passed; evidence written to {report_path}, {legal_report_path}, {support_report_path}")
else:
    print(f"staging legal/support visibility blocked; evidence written to {report_path}, {legal_report_path}, {support_report_path}")
PY

python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(0 if report["status"] == "pass" else 2)
PY
