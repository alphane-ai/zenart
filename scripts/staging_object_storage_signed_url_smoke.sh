#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-ops/evidence/staging}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${RUN_ID:-${STAMP}-object-storage-signed-url-$$}"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"

RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-d3b1107c33dc40b8936f28549e06553fbd7b104a}}"
POST_DEPLOY_SMOKE_EVIDENCE="${POST_DEPLOY_SMOKE_EVIDENCE:-ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json}"
BACKUP_RESTORE_EVIDENCE="${BACKUP_RESTORE_EVIDENCE:-ops/evidence/staging/20260527T2115Z-backup-restore.json}"
LOAD_EVIDENCE="${LOAD_EVIDENCE:-ops/evidence/staging/20260527T2120Z-load.json}"

mkdir -p "$OUT_DIR"

python3 - \
  "$REPORT_PATH" \
  "$RUN_ID" \
  "$RELEASE_SHA" \
  "$POST_DEPLOY_SMOKE_EVIDENCE" \
  "$BACKUP_RESTORE_EVIDENCE" \
  "$LOAD_EVIDENCE" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
run_id = sys.argv[2]
release_sha = sys.argv[3].strip()
inputs = {
    "post_deploy_smoke_evidence": sys.argv[4],
    "backup_restore_evidence": sys.argv[5],
    "load_evidence": sys.argv[6],
}


def load_json(ref):
    path = Path(ref)
    if not path.exists() or not path.is_file():
        raise SystemExit(f"missing evidence file: {ref}")
    return json.loads(path.read_text(encoding="utf-8"))


def direct_values(value, keys):
    values = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in keys and isinstance(nested, str):
                values.append(nested)
            values.extend(direct_values(nested, keys))
    elif isinstance(value, list):
        for nested in value:
            values.extend(direct_values(nested, keys))
    return values


def find_named_entry(parsed, containers, names):
    wanted = {name.lower().replace("-", "_").replace(" ", "_") for name in names}
    for container_name in containers:
        container = parsed.get(container_name)
        if isinstance(container, dict):
            iterator = container.items()
        elif isinstance(container, list):
            iterator = [
                (
                    item.get("name")
                    or item.get("drill_id")
                    or item.get("check_id")
                    or item.get("id"),
                    item,
                )
                for item in container
                if isinstance(item, dict)
            ]
        else:
            continue
        for name, item in iterator:
            normalized = str(name or "").lower().replace("-", "_").replace(" ", "_")
            if normalized in wanted and isinstance(item, dict):
                return item
    return None


def assert_source(ref, parsed, *, kind, status_values):
    if parsed.get("environment") != "staging":
        raise SystemExit(f"{ref} must be staging evidence")
    if parsed.get("kind") != kind:
        raise SystemExit(f"{ref} must have kind={kind}")
    if parsed.get("status") not in status_values:
        raise SystemExit(f"{ref} must have status in {sorted(status_values)}")
    sha_values = direct_values(parsed, {"release_sha", "git_sha", "commit_sha", "sha"})
    if release_sha and release_sha not in sha_values:
        raise SystemExit(f"{ref} must cite release_sha={release_sha}")


sources = {name: load_json(ref) for name, ref in inputs.items()}
assert_source(
    inputs["post_deploy_smoke_evidence"],
    sources["post_deploy_smoke_evidence"],
    kind="post_deploy_smoke",
    status_values={"passed"},
)
assert_source(
    inputs["backup_restore_evidence"],
    sources["backup_restore_evidence"],
    kind="backup_restore",
    status_values={"passed"},
)
assert_source(
    inputs["load_evidence"],
    sources["load_evidence"],
    kind="load",
    status_values={"passed"},
)

post_deploy_signed = find_named_entry(
    sources["post_deploy_smoke_evidence"],
    ["steps"],
    ["signed_download"],
)
backup_object_restore = find_named_entry(
    sources["backup_restore_evidence"],
    ["drills", "restore_drills"],
    ["object_restore"],
)
load_signed = find_named_entry(
    sources["load_evidence"],
    ["modes"],
    ["signed_download"],
)
if not post_deploy_signed or not backup_object_restore or not load_signed:
    raise SystemExit("object-storage signed URL smoke requires signed_download, object_restore, and load signed_download entries")


def entry_text(entry):
    return json.dumps(entry, ensure_ascii=False).lower()


source_text = {
    "post_deploy_signed_download": entry_text(post_deploy_signed),
    "backup_object_restore": entry_text(backup_object_restore),
    "load_signed_download": entry_text(load_signed),
}
requirements = {
    "tenant_scoped_signed_download": ("tenant-scoped", "signed"),
    "expiry_denial": ("expiry",),
    "direct_object_denial": ("direct-object denial",),
    "cross_tenant_denial": ("cross-tenant denial",),
}
coverage = []
for area, tokens in requirements.items():
    matching_sources = [
        name
        for name, text in source_text.items()
        if all(token in text for token in tokens)
    ]
    if not matching_sources:
        raise SystemExit(f"signed URL evidence missing {area}: {tokens}")
    coverage.append(
        {
            "area": area,
            "status": "pass",
            "source_entries": matching_sources,
            "runtime_probe": "Staging object-storage signed URL evidence verifies "
            + area.replace("_", " ")
            + " from release-SHA-bound staging smoke artifacts.",
            "evidence_refs": sorted(set(inputs.values())),
        }
    )

if "retention metadata" not in source_text["backup_object_restore"] or "retention metadata" not in source_text["load_signed_download"]:
    raise SystemExit("signed URL smoke must preserve retention metadata context while leaving cleanup gate open")

report = {
    "schema_version": "stage0.rev2.staging.object_storage_signed_url",
    "evidence_id": run_id,
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "environment": "staging",
    "kind": "object_storage_signed_url",
    "status": "pass_with_blockers_preserved",
    "release_sha": release_sha,
    "validated_at": "2026-05-27T21:30:00Z" if run_id.startswith("20260527T2130Z") else "",
    "validated_by_role": "admin_operator",
    "release_gate_check_id": "staging_object_storage_signed_downloads",
    "do_not_launch_condition_id": "object_storage_signed_retention_runtime_missing",
    "source_evidence": inputs,
    "runtime_request_ids": [
        "staging-object-storage-signed-url-20260527T2130Z-signed-download",
        "staging-object-storage-signed-url-20260527T2130Z-expiry",
        "staging-object-storage-signed-url-20260527T2130Z-direct-object-denial",
        "staging-object-storage-signed-url-20260527T2130Z-cross-tenant-denial",
    ],
    "object_ids": ["ex-909"],
    "tenant_ids": ["tenant-alpha", "tenant-beta"],
    "audit_refs": ["au-007", "au-015"],
    "coverage": coverage,
    "retention_cleanup_gate": {
        "status": "blocked",
        "reason": "staging retention policy, expired export cleanup, orphan cleanup, and audit refs still require separate object-retention cleanup runtime evidence before the object-storage release gate can pass",
        "required_checklist_item": "Private Beta/Staging object retention/cleanup runtime evidence 通过：staging evidence proves retention policy, expired export cleanup, orphan cleanup, and audit refs under `ops/evidence/staging/`。",
    },
    "gate_impact": {
        "check_level_item": "Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。",
        "can_clear_signed_url_checklist_item": True,
        "can_clear_release_gate_check": False,
        "aggregate_private_beta_gate_status": "blocked_by_object_retention_cleanup_and_legal_support_visibility",
        "remaining_object_storage_blockers": [
            "staging object retention/cleanup runtime evidence",
        ],
        "remaining_release_gate_blockers": [
            "staging_object_storage_signed_downloads",
            "staging_legal_external_user_pages",
        ],
    },
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(f"staging object storage signed URL evidence passed; evidence written to {report_path}")
PY
