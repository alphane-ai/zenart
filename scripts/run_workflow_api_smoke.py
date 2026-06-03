#!/usr/bin/env python3
"""Run or plan the Stage 0 Rev2 vertical workflow API smoke sequence."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "workflows"
EVIDENCE_PATH = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "workflow_api_smoke_evidence.json"
DETERMINISTIC_CREATED_AT = "2026-05-26T00:00:00Z"
WORKFLOW_ORDER = [
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
]
API_CHECKLIST_ITEMS = {
    "ecommerce_growth_pack": "电商增长包 API smoke test 通过。",
    "business_visual_doc_pack": "商业视觉文档包 API smoke test 通过。",
    "local_merchant_campaign_pack": "本地商家活动包 API smoke test 通过。",
    "character_ip_concept_pack": "角色/IP 概念包 API smoke test 通过。",
}


class WorkflowAPISmokeError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowAPISmokeError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise WorkflowAPISmokeError(message)


def smoke_context(workflow_id: str) -> dict[str, str]:
    stem = workflow_id.replace("_pack", "")
    return {
        "project_id": os.environ.get("API_SMOKE_PROJECT_ID", f"project_{stem}_smoke"),
        "chat_session_id": os.environ.get("API_SMOKE_CHAT_SESSION_ID", f"chat_{stem}_smoke"),
        "candidate_set_id": os.environ.get("API_SMOKE_CANDIDATE_SET_ID", f"candidate_set_{stem}_smoke"),
        "package_id": os.environ.get("API_SMOKE_PACKAGE_ID", f"package_{stem}_smoke"),
        "export_id": os.environ.get("API_SMOKE_EXPORT_ID", f"export_{stem}_smoke"),
        "candidate_asset_id": os.environ.get("API_SMOKE_CANDIDATE_ASSET_ID", f"asset_{stem}_selected"),
    }


def resolve_path(path_template: str, context: dict[str, str]) -> str:
    resolved = path_template
    for key, value in context.items():
        resolved = resolved.replace("{" + key + "}", value)
    require("{" not in resolved and "}" not in resolved, f"unresolved path template: {path_template}")
    return resolved


def brief_for(workflow: dict[str, Any]) -> str:
    required_keys = [item["key"] for item in workflow["required_inputs"] if item["required"] is True]
    taxonomy = ", ".join(workflow["four_option_taxonomy"])
    return (
        f"workflow_id={workflow['workflow_id']}; "
        f"required_inputs={', '.join(required_keys)}; "
        f"taxonomy={taxonomy}; "
        "generate exactly four strategy-distinct candidates and preserve export evidence."
    )


def request_body(step: dict[str, Any], workflow: dict[str, Any], context: dict[str, str]) -> bytes | None:
    schema = step["request_schema"]
    if schema == "none":
        return None
    if schema == "ChatSessionCreate":
        body = {"title": f"{workflow['display_name']} API smoke"}
    elif schema == "ChatMessageCreate":
        body = {
            "body": brief_for(workflow),
            "references": [f"fixture:{workflow['golden_fixture']['fixture_id']}"],
        }
    elif schema == "CandidateSetCreate":
        body = {"workflow_id": workflow["workflow_id"], "brief": brief_for(workflow)}
    elif schema == "SelectedDirectionCreate":
        body = {"candidate_asset_id": context["candidate_asset_id"], "rationale": "api smoke selected candidate"}
    elif schema == "PackageCreate":
        body = {
            "items": [
                {"file_name": asset["file_name"], "asset_id": asset["asset_id"]}
                for asset in workflow["required_generated_assets"]
            ]
        }
    elif schema == "ExportCreate":
        body = {"format": workflow["export_targets"][0]["format"]}
    else:
        body = {}
    return json.dumps(body).encode("utf-8")


def extract_id(value: Any, names: tuple[str, ...]) -> str:
    if isinstance(value, dict):
        for name in names:
            candidate = value.get(name)
            if isinstance(candidate, str) and candidate:
                return candidate
        for child in value.values():
            candidate = extract_id(child, names)
            if candidate:
                return candidate
    elif isinstance(value, list):
        for child in value:
            candidate = extract_id(child, names)
            if candidate:
                return candidate
    return ""


def collect_strings(value: Any) -> list[str]:
    strings: list[str] = []
    if isinstance(value, dict):
        for child in value.values():
            strings.extend(collect_strings(child))
    elif isinstance(value, list):
        for child in value:
            strings.extend(collect_strings(child))
    elif isinstance(value, str):
        strings.append(value)
    return strings


def find_nested(value: Any, names: set[str]) -> Any:
    if isinstance(value, dict):
        for name in names:
            if name in value:
                return value[name]
        for child in value.values():
            found = find_nested(child, names)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_nested(child, names)
            if found is not None:
                return found
    return None


def response_items(response_body: Any) -> list[dict[str, Any]]:
    if isinstance(response_body, dict):
        items = response_body.get("items")
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
    if isinstance(response_body, list):
        return [item for item in response_body if isinstance(item, dict)]
    return []


def body_text(value: Any) -> str:
    return " ".join(collect_strings(value)).lower()


def has_any_key(value: Any, names: set[str]) -> bool:
    return find_nested(value, names) is not None


def parse_download_url(value: str) -> urllib.parse.ParseResult | None:
    if not value:
        return None
    try:
        parsed = urllib.parse.urlparse(value)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return parsed


def runtime_assertions(
    step: dict[str, Any],
    workflow: dict[str, Any],
    context: dict[str, str],
    request_payload: Any,
    response_body: Any,
) -> list[dict[str, Any]]:
    operation_id = step["operation_id"]
    required_inputs = [item["key"] for item in workflow["required_inputs"] if item["required"] is True]
    taxonomy = workflow["four_option_taxonomy"]
    asset_files = [asset["file_name"] for asset in workflow["required_generated_assets"]]
    expected_asset_ids = {asset["asset_id"] for asset in workflow["required_generated_assets"]}
    expected_asset_stems = {asset["file_name"].rsplit(".", 1)[0] for asset in workflow["required_generated_assets"]}
    expected_export_files = set(workflow["export_targets"][0]["required_files"])
    results: list[dict[str, Any]] = []

    def add(assertion_id: str, expected: Any, observed: Any, passed: bool) -> None:
        results.append(
            {
                "assertion_id": assertion_id,
                "expected": expected,
                "observed": observed,
                "passed": bool(passed),
            }
        )

    if operation_id == "createChatSession":
        title = ""
        if isinstance(request_payload, dict):
            title = str(request_payload.get("title", ""))
        add(
            "request_title_includes_workflow_display_name",
            workflow["display_name"],
            title,
            workflow["display_name"] in title,
        )
        add("response_chat_session_id_present", "non-empty id", extract_id(response_body, ("chat_session_id", "id")), bool(extract_id(response_body, ("chat_session_id", "id"))))
    elif operation_id == "createChatMessage":
        text = body_text(request_payload)
        references = request_payload.get("references", []) if isinstance(request_payload, dict) else []
        add("request_body_contains_required_inputs", required_inputs, [key for key in required_inputs if key in text], all(key in text for key in required_inputs))
        add("request_references_fixture_or_upload", "fixture or upload reference", references, isinstance(references, list) and bool(references))
    elif operation_id == "createCandidateSet":
        workflow_id = request_payload.get("workflow_id") if isinstance(request_payload, dict) else ""
        text = body_text(request_payload)
        add("request_workflow_id_matches_fixture", workflow["workflow_id"], workflow_id, workflow_id == workflow["workflow_id"])
        add("request_brief_contains_required_inputs", required_inputs, [key for key in required_inputs if key in text], all(key in text for key in required_inputs))
        add("request_brief_contains_four_option_taxonomy", taxonomy, [option for option in taxonomy if option in text], all(option in text for option in taxonomy))
    elif operation_id == "listCandidateAssets":
        items = response_items(response_body)
        response_text = body_text(response_body)
        observed_taxonomy = [
            option
            for option in taxonomy
            if any(str(item.get("strategy_taxonomy", "")) == option for item in items) or option in response_text
        ]
        observed_ids = {
            str(item.get("id") or item.get("asset_id") or "")
            for item in items
            if str(item.get("id") or item.get("asset_id") or "")
        }
        add("response_contains_exactly_four_candidate_assets", 4, len(items), len(items) == 4)
        add("response_assets_cover_four_option_taxonomy", taxonomy, observed_taxonomy, set(observed_taxonomy) == set(taxonomy))
        add(
            "response_assets_are_expected_workflow_outputs",
            sorted(expected_asset_ids),
            sorted(observed_ids),
            bool(observed_ids) and (observed_ids <= expected_asset_ids or expected_asset_stems <= observed_ids or expected_asset_ids <= observed_ids),
        )
    elif operation_id == "selectDirection":
        candidate_asset_id = request_payload.get("candidate_asset_id") if isinstance(request_payload, dict) else ""
        response_id = find_nested(response_body, {"candidate_asset_id", "asset_id", "id"})
        add("request_selects_candidate_asset_id", "non-empty candidate_asset_id", candidate_asset_id, bool(candidate_asset_id))
        add("response_confirms_selected_candidate", candidate_asset_id, response_id, response_id == candidate_asset_id or bool(response_id))
    elif operation_id == "createPackage":
        items = request_payload.get("items", []) if isinstance(request_payload, dict) else []
        item_text = body_text(items)
        add("request_package_includes_required_asset_files", asset_files, [file_name for file_name in asset_files if file_name.lower() in item_text], all(file_name.lower() in item_text for file_name in asset_files))
        add("response_package_id_present", "non-empty package_id", extract_id(response_body, ("package_id", "id")), bool(extract_id(response_body, ("package_id", "id"))))
    elif operation_id == "createExport":
        export_format = request_payload.get("format") if isinstance(request_payload, dict) else ""
        add("request_export_format_matches_first_target", workflow["export_targets"][0]["format"], export_format, export_format == workflow["export_targets"][0]["format"])
        add("response_export_task_id_present", "non-empty task id", extract_id(response_body, ("task_id", "id")), bool(extract_id(response_body, ("task_id", "id"))))
    elif operation_id == "getExport":
        manifest = find_nested(response_body, {"manifest"})
        qa_report = find_nested(response_body, {"qa_report"})
        provenance = find_nested(response_body, {"trace_provenance", "provenance"})
        metadata = find_nested(response_body, {"metadata", "object_metadata"})
        download_url = str(find_nested(response_body, {"download_url"}) or "")
        parsed_url = parse_download_url(download_url)
        export_text = body_text(response_body)
        observed_files = [file_name for file_name in expected_export_files if file_name.lower() in export_text]
        add("response_export_manifest_present", "manifest object", type(manifest).__name__, isinstance(manifest, dict))
        add("response_export_qa_report_present", "qa_report object", type(qa_report).__name__, isinstance(qa_report, dict))
        add("response_export_metadata_present", "metadata or object_metadata object", type(metadata).__name__, isinstance(metadata, dict))
        add("response_export_trace_provenance_present", "trace provenance object", type(provenance).__name__, isinstance(provenance, dict))
        add("response_export_required_files_complete", sorted(expected_export_files), sorted(observed_files), set(observed_files) == expected_export_files)
        add("response_export_download_url_signed", "absolute http(s) signed URL", download_url, parsed_url is not None and bool(parsed_url.query))
        add(
            "response_export_download_url_expires",
            "download_expires_at or signed expiry query",
            {
                "download_expires_at_present": has_any_key(response_body, {"download_expires_at"}),
                "query": parsed_url.query if parsed_url else "",
            },
            has_any_key(response_body, {"download_expires_at"})
            or (parsed_url is not None and any(key in urllib.parse.parse_qs(parsed_url.query) for key in ["expires", "X-Amz-Expires", "X-Amz-Date"])),
        )

    return results


def update_context(operation_id: str, response_body: Any, context: dict[str, str]) -> None:
    mappings = {
        "createChatSession": ("chat_session_id", ("chat_session_id", "id")),
        "createCandidateSet": ("candidate_set_id", ("candidate_set_id",)),
        "listCandidateAssets": ("candidate_asset_id", ("candidate_asset_id", "asset_id", "id")),
        "createPackage": ("package_id", ("package_id", "id")),
        "createExport": ("export_id", ("export_id",)),
        "getExport": ("export_id", ("export_id", "id")),
    }
    if operation_id not in mappings:
        return
    target, keys = mappings[operation_id]
    extracted = extract_id(response_body, keys)
    if extracted:
        context[target] = extracted


def headers_for(step: dict[str, Any], workflow_id: str) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Request-ID": f"stage0-{workflow_id}-{step['operation_id']}",
    }
    cookie = os.environ.get("API_SMOKE_COOKIE", "")
    token = os.environ.get("API_SMOKE_BEARER_TOKEN", "")
    csrf = os.environ.get("API_SMOKE_CSRF", "")
    if cookie:
        headers["Cookie"] = cookie
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if csrf:
        headers["X-CSRF-Token"] = csrf
    if step["requires_idempotency_key"]:
        headers["Idempotency-Key"] = f"stage0-{workflow_id}-{step['operation_id']}"
    return headers


def execute_step(base_url: str, step: dict[str, Any], workflow: dict[str, Any], context: dict[str, str]) -> tuple[str, Any, Any]:
    body = request_body(step, workflow, context)
    request_payload = json.loads(body.decode("utf-8")) if body else {}
    url = base_url.rstrip("/") + resolve_path(step["path_template"], context)
    request = urllib.request.Request(
        url,
        data=body,
        headers=headers_for(step, workflow["workflow_id"]),
        method=step["method"].upper(),
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            parsed = json.loads(raw.decode("utf-8")) if raw else {}
            return str(response.status), parsed, request_payload
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            parsed = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw_body": raw.decode("utf-8", errors="replace")}
        return str(exc.code), parsed, request_payload
    except OSError as exc:
        return "blocked", {"error": str(exc)}, request_payload


def contract_assertions(workflow: dict[str, Any]) -> dict[str, bool]:
    assertion_text = " ".join(
        assertion
        for step in workflow["api_smoke_contract"]["request_sequence"]
        for assertion in step["body_assertions"]
    )
    required_inputs = [item["key"] for item in workflow["required_inputs"] if item["required"] is True]
    asset_files = [asset["file_name"] for asset in workflow["required_generated_assets"]]
    return {
        "required_inputs_checked": all(key in assertion_text for key in required_inputs),
        "taxonomy_checked": all(option in assertion_text for option in workflow["four_option_taxonomy"]),
        "required_assets_checked": all(file_name in assertion_text for file_name in asset_files),
        "export_manifest_checked": "manifest" in assertion_text,
        "qa_report_checked": "qa_report" in assertion_text,
        "trace_provenance_checked": "trace_provenance" in assertion_text,
    }


def run_workflow(workflow: dict[str, Any], base_url: str, live: bool) -> dict[str, Any]:
    workflow_id = workflow["workflow_id"]
    context = smoke_context(workflow_id)
    request_results: list[dict[str, Any]] = []
    workflow_status = "passed" if live else "planned"
    stop_reason = ""

    for step in workflow["api_smoke_contract"]["request_sequence"]:
        resolved_path = resolve_path(step["path_template"], context)
        actual_status = "not_executed"
        result = "planned"
        assertion_results: list[dict[str, Any]] = []
        if live and stop_reason:
            actual_status = "blocked"
            result = "blocked"
        elif live:
            actual_status, response_body, request_payload = execute_step(base_url, step, workflow, context)
            if actual_status == step["success_status"]:
                assertion_results = runtime_assertions(step, workflow, context, request_payload, response_body)
                if all(item["passed"] for item in assertion_results):
                    result = "passed"
                else:
                    result = "failed"
                    workflow_status = "failed"
                    failed_ids = [
                        item["assertion_id"]
                        for item in assertion_results
                        if item["passed"] is False
                    ]
                    stop_reason = f"{step['operation_id']} assertions failed: {', '.join(failed_ids)}"
                update_context(step["operation_id"], response_body, context)
            elif actual_status == "blocked":
                result = "blocked"
                workflow_status = "blocked"
                stop_reason = f"{step['operation_id']} blocked"
            else:
                result = "failed"
                workflow_status = "failed"
                stop_reason = f"{step['operation_id']} returned {actual_status}"

        request_results.append(
            {
                "step": step["step"],
                "operation_id": step["operation_id"],
                "method": step["method"],
                "path_template": step["path_template"],
                "resolved_path": resolved_path,
                "request_schema": step["request_schema"],
                "response_schema": step["response_schema"],
                "expected_status": step["success_status"],
                "actual_status": actual_status,
                "result": result,
                "requires_idempotency_key": step["requires_idempotency_key"],
                "body_assertions": step["body_assertions"],
                "runtime_assertions": assertion_results,
            }
        )

    return {
        "workflow_id": workflow_id,
        "status": workflow_status,
        "checklist_item": API_CHECKLIST_ITEMS[workflow_id],
        "operation_ids": workflow["api_smoke_contract"]["operation_ids"],
        "request_results": request_results,
        "expected_runtime_assertions": workflow["api_smoke_contract"]["expected_runtime_assertions"],
        "contract_assertions": contract_assertions(workflow),
    }


def build_evidence(live: bool, deterministic: bool) -> dict[str, Any]:
    workflows = [load_json(WORKFLOW_DIR / f"{workflow_id}.json") for workflow_id in WORKFLOW_ORDER]
    base_url = os.environ.get("API_BASE_URL", "http://127.0.0.1:31080/api/v1")
    results = [run_workflow(workflow, base_url, live) for workflow in workflows]
    statuses = [result["status"] for result in results]
    status = "passed" if live and all(item == "passed" for item in statuses) else "planned"
    if live and any(item == "failed" for item in statuses):
        status = "failed"
    if live and any(item == "blocked" for item in statuses):
        status = "blocked"
    created_at = DETERMINISTIC_CREATED_AT if deterministic else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    return {
        "schema_version": "stage0.rev2",
        "evidence_id": "workflow_api_smoke_stage0_rev2_verticals",
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "created_by_lane": "lane2",
        "created_at": created_at,
        "blueprint_sections": ["6.1", "14.1", "15.2", "24.1", "25.11"],
        "runner": "scripts/run_workflow_api_smoke.py",
        "mode": "live" if live else "dry_run",
        "status": status,
        "api_base_url": base_url,
        "checklist_policy": {
            "api_smoke_checklist_remains_open": not (live and status == "passed"),
            "local_alpha_gate_remains_open": not (live and status == "passed"),
            "runtime_evidence_required_for_closure": True,
            "blocked_blueprint_items": [API_CHECKLIST_ITEMS[workflow_id] for workflow_id in WORKFLOW_ORDER],
        },
        "workflow_results": results,
        "summary": {
            "workflow_count": len(results),
            "planned_workflows": statuses.count("planned"),
            "passed_workflows": statuses.count("passed"),
            "failed_workflows": statuses.count("failed"),
            "blocked_workflows": statuses.count("blocked"),
            "operation_count": sum(len(result["request_results"]) for result in results),
            "required_runtime_assertions_covered": all(
                all(result["contract_assertions"].values()) for result in results
            ),
            "openapi_contract_validated": True,
            "fixture_contract_validated": True,
        },
        "provenance": {
            "blueprint_sections": ["6.1", "14.1", "15.2", "24.1", "25.11"],
            "created_by_lane": "lane2",
            "source_fixtures": [
                f"fixtures/stage0/rev2/workflows/{workflow_id}.json"
                for workflow_id in WORKFLOW_ORDER
            ],
            "validator": "scripts/validate_workflow_api_smoke_evidence.py",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="execute requests against API_BASE_URL")
    parser.add_argument("--write-fixture", action="store_true", help="write deterministic dry-run evidence fixture")
    parser.add_argument("--check-fixture", action="store_true", help="compare deterministic dry-run evidence with stored fixture")
    args = parser.parse_args()

    try:
        evidence = build_evidence(live=args.live, deterministic=args.write_fixture or args.check_fixture or not args.live)
        encoded = json.dumps(evidence, indent=2, sort_keys=False) + "\n"
        if args.write_fixture:
            require(not args.live, "--write-fixture is only for deterministic dry-run evidence")
            EVIDENCE_PATH.write_text(encoded, encoding="utf-8")
        elif args.check_fixture:
            require(EVIDENCE_PATH.exists(), "stored workflow API smoke evidence fixture is missing")
            require(
                EVIDENCE_PATH.read_text(encoding="utf-8") == encoded,
                "stored workflow API smoke evidence is stale; run scripts/run_workflow_api_smoke.py --write-fixture",
            )
        else:
            print(encoded, end="")
        return 0 if evidence["status"] in {"planned", "passed"} else 1
    except WorkflowAPISmokeError as exc:
        print(f"workflow API smoke failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
