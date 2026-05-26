#!/usr/bin/env python3
"""Validate Stage 0 Rev2 fixture/provenance/release-gate basics."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
SCHEMA_DIR = ROOT / "schemas" / "stage0" / "rev2"
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
OPS_FIXTURE_DIR = ROOT / "fixtures" / "ops"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
MIGRATION_DIR = ROOT / "backend" / "migrations"
CI_WORKFLOW = ROOT / ".github" / "workflows" / "stage0-rev2-ci.yml"
CI_DRAFT = ROOT / "ops" / "ci" / "stage0-rev2-ci.yml"
CI_INSTALLATION = ROOT / "ops" / "ci" / "INSTALLATION.md"
CI_DRAFT_EVIDENCE = OPS_FIXTURE_DIR / "stage0_rev2_ci_draft_evidence.json"
ENVIRONMENT_EVIDENCE = ROOT / "ops" / "evidence" / "stage0_environment_evidence.json"
DRILL_PLAN_EVIDENCE = ROOT / "ops" / "evidence" / "stage0_drill_plan.json"

WORKFLOWS = {
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
}

EVAL_CATEGORIES = {
    "golden",
    "ambiguous_brief",
    "unsafe",
    "negative",
    "brand_product_preservation",
    "text_heavy",
    "export_completeness",
    "red_team",
}

SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

CRAWLER_CASES = {
    "approved_source",
    "disallowed_source",
    "robots_denied",
    "duplicate_hash",
    "pending_review_import",
}

LOCAL_ALPHA_SERVICE_PATHS = {
    "web": [
        "web/package.json",
        "web/app/layout.tsx",
        "web/app/page.tsx",
        "web/Dockerfile",
    ],
    "admin": [
        "admin/package.json",
        "admin/app/layout.tsx",
        "admin/app/page.tsx",
        "admin/Dockerfile",
    ],
    "backend": [
        "backend/go.mod",
        "backend/cmd/server/main.go",
        "backend/cmd/worker/main.go",
        "backend/cmd/crawler/main.go",
        "backend/cmd/migrate/main.go",
        "backend/Dockerfile",
    ],
}

LOCAL_ALPHA_RUNTIME_FILES = [
    ".env.example",
    "docker-compose.yml",
]

CHECKLIST_FILE_EVIDENCE = {
    "创建 Alphane-style 纯 Web 三端 monorepo 目录：`web/` 用户端、`admin/` 管理端、`backend/` Go API/worker/crawler/migrate、`scripts/`。": [
        "web",
        "admin",
        "backend",
        "scripts",
    ],
    "新增根目录 `.env.example`，覆盖 web、admin、backend、Postgres、Redis、object storage、auth、session、provider、billing、observability、crawler、analytics。": [
        ".env.example",
    ],
    "新增根目录 `docker-compose.yml`，可启动 web、admin、backend server、worker、crawler、Postgres、Redis、local object storage。": [
        "docker-compose.yml",
    ],
    "新增 README，说明 Rev2 是唯一权威源，并给出本地启动命令。": [
        "README.md",
    ],
    "配置 git ignore，排除 `.cron/`、`.ops/`、logs、node_modules、build 输出、临时导出包、本地对象存储数据。": [
        ".gitignore",
    ],
}

GATE_CHECKLIST_ITEMS = {
    "Local Alpha Gate 全部通过。": "local_alpha",
    "CI Gate 全部通过。": "ci",
    "Private Beta/Staging Gate 全部通过。": "private_beta_staging",
    "Production Launch Gate 全部通过。": "production_launch",
}

SCHEMA_FIXTURE_TARGETS = [
    ("eval_suite.schema.json", FIXTURE_DIR / "eval" / "starter_eval_suite.json", "object"),
    ("qa_result.schema.json", FIXTURE_DIR / "eval" / "qa_results.json", "array_items"),
    ("safety_rule.schema.json", FIXTURE_DIR / "eval" / "safety_rules.json", "array_items"),
    ("workflow_acceptance.schema.json", FIXTURE_DIR / "workflows", "directory_objects"),
    ("crawler_governance.schema.json", FIXTURE_DIR / "crawler" / "crawler_governance_cases.json", "array_items"),
    ("feedback_event.schema.json", FIXTURE_DIR / "feedback" / "feedback_events.json", "array_items"),
    ("abuse_event.schema.json", FIXTURE_DIR / "abuse" / "abuse_events.json", "array_items"),
    ("release_gate_evidence.schema.json", FIXTURE_DIR / "release_gate_evidence.local_alpha.json", "object"),
]

CHECKED_ITEMS = {
    "定义 eval suite schema。",
    "创建四条 workflow golden fixtures。",
    "创建 ambiguous/unsafe/negative fixtures。",
    "创建 brand/product preservation fixtures。",
    "创建 text-heavy fixtures。",
    "创建 export completeness fixtures。",
    "定义 QA result schema。",
    "实现 safety rule schema。",
    "实现 red-team fixtures。",
    "定义 vertical acceptance schema。",
    "每条 workflow 定义 required inputs。",
    "每条 workflow 定义 clarification questions。",
    "每条 workflow 定义 4-option taxonomy。",
    "每条 workflow 定义 required package outputs。",
    "每条 workflow 定义 QA/safety/export pass thresholds。",
    "实现 source legal metadata。",
    "添加 disallowed source、robots denied、duplicate hash、pending-review import tests。",
    "实现 feedback taxonomy。",
    "实现 feedback attribution。",
    "实现 abuse event model。",
}

FORBIDDEN_CHECKED_ITEMS = {
    "实现 eval runner。",
    "存储 eval results。",
    "skill canary 前要求 eval pass。",
    "prompt fragment active 前要求 eval pass。",
    "在 brief/provider request/provider response/QA/export 运行 safety policy。",
    "实现 crawler source approval。",
    "实现 provenance links。",
    "实现 temporary hold/throttle hooks。",
    "实现 admin abuse queue。",
}

DATABASE_TABLES = {
    "users",
    "sessions",
    "roles",
    "audit_logs",
    "projects",
    "workspaces",
    "canvas_nodes",
    "canvas_edges",
    "canvas_frames",
    "canvas_versions",
    "chat_sessions",
    "chat_messages",
    "agent_tasks",
    "agent_traces",
    "candidate_sets",
    "candidate_assets",
    "selected_directions",
    "uploads",
    "assets",
    "object_metadata",
    "packages",
    "package_items",
    "exports",
    "share_links",
    "share_link_access_logs",
    "skills",
    "skill_versions",
    "skill_sources",
    "skill_release_channels",
    "skill_usage_stats",
    "prompt_fragments",
    "fragment_versions",
    "mutations",
    "mutation_reviews",
    "meta_prompts",
    "meta_prompt_versions",
    "image_specs",
    "spec_instances",
    "spec_evaluations",
    "eval_suites",
    "eval_fixtures",
    "eval_results",
    "crawler_sources",
    "crawler_runs",
    "crawler_documents",
    "crawler_findings",
    "crawler_import_reviews",
    "quota_buckets",
    "quota_transactions",
    "subscription_plans",
    "user_subscriptions",
    "provider_usage_logs",
    "feedback_events",
    "feedback_labels",
    "feedback_performance_daily",
    "safety_rules",
    "safety_decisions",
    "qa_results",
    "support_tickets",
    "abuse_events",
    "incident_logs",
}

DATABASE_SEED_TOKENS = {
    "plan_default_local",
    "user_local_admin",
    "user_local_user",
    "skill_internal_workflow_planner",
    "skill_internal_export_builder",
    "project_local_ecommerce_growth",
    "project_local_business_doc",
    "project_local_merchant_campaign",
    "project_local_character_ip",
    "crawler_source_stage0_allowed",
}

OPENAPI_REQUIRED_TOKENS = {
    "openapi: 3.1.0",
    "ErrorEnvelope:",
    "request_id:",
    "x-rbac: user",
    "x-rbac: admin",
    "page_token",
    "page_size",
    "sort",
    "search",
    "Idempotency-Key",
    "x-idempotency-required: true",
    "TaskStatus:",
    "enum: [pending, running, succeeded, failed, cancelled]",
    "progress:",
    "retry_count:",
    "timeout_at:",
    "app_version:",
    "worker_version:",
}

OPENAPI_REQUIRED_OPERATION_IDS = {
    "getSession",
    "getAccount",
    "listProjects",
    "getWorkspace",
    "createChatMessage",
    "getTask",
    "listCandidateSets",
    "listCanvasNodes",
    "createUpload",
    "listAssets",
    "createPackage",
    "createExport",
    "getQuota",
    "getSubscription",
    "createSupportTicket",
    "listSupportTickets",
    "listExports",
    "listProviderStatus",
    "listProviderUsage",
    "listAbuseEvents",
    "listSkills",
    "listCrawlerSources",
    "listPromptFragments",
    "listTraces",
    "listFeedback",
    "listSafetyRules",
    "listAuditLogs",
}

OPENAPI_REQUIRED_CONTRACT_TOKENS = {
    "ObjectMetadata:",
    "upload_url:",
    "download_url:",
    "object_metadata:",
    "manifest:",
    "qa_report:",
    "provenance:",
    "ShareLink:",
    "access_policy:",
    "token_hash:",
    "direct_object_access_allowed:",
    "audit_access_required:",
    "CrawlerSource:",
    "legal_metadata:",
    "robots_policy:",
    "CrawlerFinding:",
    "import_governance:",
    "admin_review_required:",
    "SafetyRule:",
    "enforcement_points:",
    "enum: [brief, provider_request, provider_response, qa, export]",
    "evaluation_contract:",
    "blocks_export_when_critical:",
    "const: SafetyDecision",
}

OPS_EVIDENCE_REQUIRED_KEYS = {
    "schema_version",
    "evidence_id",
    "blueprint_source",
    "created_by_lane",
    "blueprint_sections",
    "installation_status",
    "token_blocked_reason",
    "draft_ref",
    "checklist_policy",
    "artifact_checks",
    "release_gate_effect",
}


class ValidationError(Exception):
    pass


def fail(message: str) -> None:
    raise ValidationError(message)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"{path.relative_to(ROOT)} is not valid JSON: {exc}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else [value]


def walk_values(value: Any) -> list[Any]:
    values = [value]
    if isinstance(value, dict):
        for child in value.values():
            values.extend(walk_values(child))
    elif isinstance(value, list):
        for child in value:
            values.extend(walk_values(child))
    return values


def repo_path(path: str) -> Path:
    return ROOT / path


def missing_repo_paths(paths: list[str]) -> list[str]:
    return [path for path in paths if not repo_path(path).exists()]


def local_alpha_service_missing() -> dict[str, list[str]]:
    return {
        service: missing_repo_paths(paths)
        for service, paths in LOCAL_ALPHA_SERVICE_PATHS.items()
        if missing_repo_paths(paths)
    }


def local_alpha_runtime_missing() -> list[str]:
    return missing_repo_paths(LOCAL_ALPHA_RUNTIME_FILES)


def local_alpha_runtime_stack_validated() -> bool:
    if local_alpha_runtime_missing():
        return False
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    required_tokens = [
        "web",
        "admin",
        "backend",
        "worker",
        "crawler",
        "postgres",
        "redis",
    ]
    return all(re.search(rf"(^|\s){re.escape(token)}\s*:", compose, flags=re.MULTILINE) for token in required_tokens)


def release_evidence_by_gate() -> dict[str, dict[str, Any]]:
    evidence: dict[str, dict[str, Any]] = {}
    for path in sorted(FIXTURE_DIR.glob("release_gate_evidence.*.json")):
        data = load_json(path)
        evidence[data["gate"]] = data
    return evidence


def gate_allows_checklist_completion(data: dict[str, Any]) -> bool:
    return all(check["status"] == "pass" for check in data["checks"]) and not any(
        item["is_present"] for item in data["do_not_launch_checks"]
    )


def validate_schema_value(schema: dict[str, Any], value: Any, path: str, root_schema: dict[str, Any]) -> None:
    if "$ref" in schema:
        ref = schema["$ref"]
        require(ref.startswith("#/$defs/"), f"{path} uses unsupported schema ref {ref}")
        def_name = ref.removeprefix("#/$defs/")
        try:
            schema = root_schema["$defs"][def_name]
        except KeyError:
            fail(f"{path} references missing schema def {def_name}")

    if "const" in schema:
        require(value == schema["const"], f"{path} must equal {schema['const']!r}")
    if "enum" in schema:
        require(value in schema["enum"], f"{path} has unsupported value {value!r}")

    expected_type = schema.get("type")
    if expected_type == "object":
        require(isinstance(value, dict), f"{path} must be an object")
        required = set(schema.get("required", []))
        missing = required - set(value)
        require(not missing, f"{path} missing required keys: {sorted(missing)}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = set(value) - set(properties)
            require(not extra, f"{path} has additional keys: {sorted(extra)}")
        for key, child in value.items():
            if key in properties:
                validate_schema_value(properties[key], child, f"{path}.{key}", root_schema)
    elif expected_type == "array":
        require(isinstance(value, list), f"{path} must be an array")
        if "minItems" in schema:
            require(len(value) >= schema["minItems"], f"{path} must have at least {schema['minItems']} items")
        if "maxItems" in schema:
            require(len(value) <= schema["maxItems"], f"{path} must have at most {schema['maxItems']} items")
        if schema.get("uniqueItems") is True:
            encoded = [json.dumps(item, sort_keys=True) for item in value]
            require(len(encoded) == len(set(encoded)), f"{path} must contain unique items")
        if "items" in schema:
            for index, item in enumerate(value):
                validate_schema_value(schema["items"], item, f"{path}[{index}]", root_schema)
    elif expected_type == "string":
        require(isinstance(value, str), f"{path} must be a string")
        if "minLength" in schema:
            require(len(value) >= schema["minLength"], f"{path} must not be empty")
        if "pattern" in schema:
            require(re.search(schema["pattern"], value), f"{path} does not match {schema['pattern']}")
        if schema.get("format") == "date":
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError:
                fail(f"{path} must be a YYYY-MM-DD date")
        if schema.get("format") == "uri":
            parsed = urlparse(value)
            require(bool(parsed.scheme and parsed.netloc), f"{path} must be an absolute URI")
    elif expected_type == "integer":
        require(isinstance(value, int) and not isinstance(value, bool), f"{path} must be an integer")
        if "minimum" in schema:
            require(value >= schema["minimum"], f"{path} must be >= {schema['minimum']}")
        if "maximum" in schema:
            require(value <= schema["maximum"], f"{path} must be <= {schema['maximum']}")
    elif expected_type == "number":
        require(
            isinstance(value, (int, float)) and not isinstance(value, bool),
            f"{path} must be a number",
        )
        if "minimum" in schema:
            require(value >= schema["minimum"], f"{path} must be >= {schema['minimum']}")
        if "maximum" in schema:
            require(value <= schema["maximum"], f"{path} must be <= {schema['maximum']}")
    elif expected_type == "boolean":
        require(isinstance(value, bool), f"{path} must be a boolean")


def validate_fixture_against_schema(schema_name: str, fixture_path: Path, mode: str) -> None:
    schema_path = SCHEMA_DIR / schema_name
    schema = load_json(schema_path)
    if mode == "object":
        validate_schema_value(schema, load_json(fixture_path), str(fixture_path.relative_to(ROOT)), schema)
    elif mode == "array_items":
        data = load_json(fixture_path)
        require(isinstance(data, list), f"{fixture_path.relative_to(ROOT)} must be an array")
        for index, item in enumerate(data):
            validate_schema_value(schema, item, f"{fixture_path.relative_to(ROOT)}[{index}]", schema)
    elif mode == "directory_objects":
        for path in sorted(fixture_path.glob("*.json")):
            validate_schema_value(schema, load_json(path), str(path.relative_to(ROOT)), schema)
    else:
        fail(f"unsupported schema validation mode: {mode}")


def validate_json_files() -> None:
    required = [
        SCHEMA_DIR / "eval_suite.schema.json",
        SCHEMA_DIR / "qa_result.schema.json",
        SCHEMA_DIR / "safety_rule.schema.json",
        SCHEMA_DIR / "workflow_acceptance.schema.json",
        SCHEMA_DIR / "crawler_governance.schema.json",
        SCHEMA_DIR / "feedback_event.schema.json",
        SCHEMA_DIR / "abuse_event.schema.json",
        SCHEMA_DIR / "release_gate_evidence.schema.json",
        FIXTURE_DIR / "eval" / "starter_eval_suite.json",
        FIXTURE_DIR / "eval" / "qa_results.json",
        FIXTURE_DIR / "eval" / "safety_rules.json",
        FIXTURE_DIR / "crawler" / "crawler_governance_cases.json",
        FIXTURE_DIR / "feedback" / "feedback_events.json",
        FIXTURE_DIR / "abuse" / "abuse_events.json",
        FIXTURE_DIR / "release_gate_evidence.local_alpha.json",
        CI_DRAFT_EVIDENCE,
    ]
    for path in required:
        require(path.exists(), f"missing required file: {path.relative_to(ROOT)}")

    for path in sorted(SCHEMA_DIR.glob("*.json")) + sorted(FIXTURE_DIR.rglob("*.json")) + sorted(OPS_FIXTURE_DIR.rglob("*.json")):
        load_json(path)


def validate_schema_fixture_contracts() -> None:
    for schema_name, fixture_path, mode in SCHEMA_FIXTURE_TARGETS:
        validate_fixture_against_schema(schema_name, fixture_path, mode)


def validate_provenance() -> None:
    for path in sorted(FIXTURE_DIR.rglob("*.json")) + sorted(OPS_FIXTURE_DIR.rglob("*.json")):
        data = load_json(path)
        for value in walk_values(data):
            if isinstance(value, dict) and "created_by_lane" in value:
                require(
                    value["created_by_lane"] == "lane6",
                    f"{path.relative_to(ROOT)} has non-lane6 provenance",
                )
                require(
                    value.get("blueprint_sections"),
                    f"{path.relative_to(ROOT)} provenance lacks blueprint_sections",
                )


def validate_ops_ci_artifact_evidence() -> None:
    ci_text = CI_DRAFT.read_text(encoding="utf-8")
    evidence = load_json(CI_DRAFT_EVIDENCE)
    missing_keys = OPS_EVIDENCE_REQUIRED_KEYS - set(evidence)
    require(not missing_keys, f"ops CI draft evidence missing keys: {sorted(missing_keys)}")
    require(
        evidence["schema_version"] == "stage0.rev2.ops",
        "ops CI draft evidence must use stage0.rev2.ops schema version",
    )
    require(
        evidence["blueprint_source"] == "Docs/stage0_blueprint_rev2.md",
        "ops CI draft evidence must cite authoritative Rev2 blueprint",
    )
    require(evidence["created_by_lane"] == "lane6", "ops CI draft evidence must be lane6-owned")
    require(
        evidence["installation_status"] == "token_blocked",
        "ops CI draft evidence must mark workflow installation token-blocked",
    )
    require(
        ".github/workflows" in evidence["token_blocked_reason"],
        "ops CI draft evidence must explain that .github/workflows cannot be changed",
    )
    require(
        evidence["draft_ref"] == "ops/ci/stage0-rev2-ci.yml",
        "ops CI draft evidence must point at the ops/ci draft",
    )

    policy = evidence["checklist_policy"]
    require(
        policy.get("ci_installation_checklist_remains_open") is True,
        "CI installation checklist must remain open while workflow scope is token-blocked",
    )
    require(
        any("CI Gate" in item for item in policy.get("blocked_blueprint_items", [])),
        "ops evidence must keep CI Gate blocked until installed workflow can run",
    )

    artifact_ids = {item["artifact_id"] for item in evidence["artifact_checks"]}
    required_artifacts = {"ops_ci_draft", "migration_artifacts", "openapi_artifacts"}
    require(
        required_artifacts <= artifact_ids,
        f"ops evidence missing artifact checks: {sorted(required_artifacts - artifact_ids)}",
    )
    for item in evidence["artifact_checks"]:
        require(item["status"] == "pass", f"{item['artifact_id']} evidence must pass")
        for path in item["paths"]:
            require(repo_path(path).exists(), f"{item['artifact_id']} evidence path missing: {path}")
        for token in item["required_draft_tokens"]:
            require(token in ci_text, f"{item['artifact_id']} draft token missing: {token}")

    gate_effect = evidence["release_gate_effect"]
    require(
        gate_effect.get("ci_gate_status") == "blocked",
        "CI gate evidence must remain blocked until the workflow is installed and passing",
    )

    if not CI_WORKFLOW.exists():
        text = BLUEPRINT.read_text(encoding="utf-8")
        require(
            "- [ ] 添加 PR/main CI 到 `.github/workflows`。" in text,
            "PR/main CI workflow installation checklist must remain open when no installed workflow exists",
        )
        require(
            "- [x] 添加 PR/main CI draft/evidence 到 `ops/ci/` 和 `fixtures/ops/`。" in text,
            "PR/main CI draft/evidence checklist must be complete when ops and fixture evidence exists",
        )
        require(
            "- [ ] CI Gate 全部通过。" in text,
            "CI Gate checklist must remain open when no installed workflow exists",
        )


def validate_workflows() -> None:
    workflow_files = sorted((FIXTURE_DIR / "workflows").glob("*.json"))
    workflow_ids = set()
    for path in workflow_files:
        data = load_json(path)
        workflow_ids.add(data["workflow_id"])
        require(
            len(data["four_option_taxonomy"]) == 4,
            f"{path.relative_to(ROOT)} must define exactly four taxonomy options",
        )
        require(
            set(data["pass_thresholds"]["safety"]["required_enforcement_points"]) == SAFETY_POINTS,
            f"{path.relative_to(ROOT)} must require all safety enforcement points",
        )
        export = data["pass_thresholds"]["export"]
        for key in [
            "requires_manifest",
            "requires_assets",
            "requires_qa_report",
            "requires_metadata",
            "requires_safety_disclaimer_when_applicable",
            "requires_trace_provenance",
        ]:
            require(export.get(key) is True, f"{path.relative_to(ROOT)} export threshold {key} must be true")
    require(workflow_ids == WORKFLOWS, f"workflow fixtures mismatch: {sorted(workflow_ids)}")


def validate_eval_suite() -> None:
    data = load_json(FIXTURE_DIR / "eval" / "starter_eval_suite.json")
    require(data["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval suite must cite authoritative blueprint")
    categories = {fixture["category"] for fixture in data["fixtures"]}
    require(EVAL_CATEGORIES <= categories, f"eval suite missing categories: {sorted(EVAL_CATEGORIES - categories)}")
    golden_workflows = {
        fixture["workflow"]
        for fixture in data["fixtures"]
        if fixture["category"] == "golden"
    }
    require(golden_workflows == WORKFLOWS, "eval suite must include one golden fixture per workflow")
    for fixture in data["fixtures"]:
        require(fixture["workflow"] in WORKFLOWS, f"unknown workflow in {fixture['fixture_id']}")
        evidence = fixture["expected_evidence"]
        if fixture["category"] == "golden":
            require(evidence["minimum_candidates"] == 4, f"{fixture['fixture_id']} must expect four candidates")
            require(evidence["must_include_manifest"], f"{fixture['fixture_id']} must require manifest")
            require(evidence["must_include_qa_report"], f"{fixture['fixture_id']} must require QA report")
            require(evidence["must_include_trace_provenance"], f"{fixture['fixture_id']} must require trace provenance")


def validate_qa_and_safety() -> None:
    qa_results = load_json(FIXTURE_DIR / "eval" / "qa_results.json")
    severities = {item["severity"] for item in qa_results}
    require({"warning", "blocking"} <= severities, "QA fixtures must include warning and blocking examples")

    rules = load_json(FIXTURE_DIR / "eval" / "safety_rules.json")
    domains = {item["domain"] for item in rules}
    require({"financial", "adult_minor", "ip_brand"} <= domains, "safety fixtures lack required high-risk domains")
    for rule in rules:
        require(
            set(rule["enforcement_points"]) == SAFETY_POINTS,
            f"{rule['rule_id']} must cover all enforcement points",
        )
        if rule["severity"] == "critical":
            require(rule["action"] == "block", f"{rule['rule_id']} critical rules must block")


def validate_crawler_feedback_abuse() -> None:
    crawler = load_json(FIXTURE_DIR / "crawler" / "crawler_governance_cases.json")
    cases = {item["case_type"] for item in crawler}
    require(CRAWLER_CASES <= cases, f"crawler fixtures missing cases: {sorted(CRAWLER_CASES - cases)}")
    for case in crawler:
        require(
            case["import_governance"]["direct_activation_allowed"] is False,
            f"{case['fixture_id']} must deny direct activation",
        )
        require(
            case["import_governance"]["provenance_links_required"] is True,
            f"{case['fixture_id']} must require provenance links",
        )

    feedback = load_json(FIXTURE_DIR / "feedback" / "feedback_events.json")
    require(
        {"select", "reject", "qa_warning"} <= {item["event_type"] for item in feedback},
        "feedback fixtures must cover select, reject, and QA warning",
    )
    for event in feedback:
        require(
            event["governance"]["may_activate_prompt_or_skill_directly"] is False,
            f"{event['event_id']} must not allow direct activation",
        )

    abuse = load_json(FIXTURE_DIR / "abuse" / "abuse_events.json")
    require(
        {"repeated_safety_blocks", "prompt_injection", "crawler_abuse"} <= {item["event_type"] for item in abuse},
        "abuse fixtures missing required event types",
    )
    for event in abuse:
        controls = event["controls"]
        require(
            controls["rate_limit"] or controls["temporary_hold"] or controls["admin_abuse_queue"],
            f"{event['event_id']} must have at least one control",
        )


def validate_release_gate_evidence() -> None:
    data = load_json(FIXTURE_DIR / "release_gate_evidence.local_alpha.json")
    require(data["gate"] == "local_alpha", "release gate fixture must target local alpha")
    check_ids = {check["check_id"] for check in data["checks"]}
    checks = {check["check_id"]: check for check in data["checks"]}
    require(
        {"workflow_fixture_coverage", "eval_fixture_coverage", "crawler_governance_fixture_coverage"} <= check_ids,
        "local alpha evidence missing fixture coverage checks",
    )
    require(
        "schema_fixture_validation" in check_ids,
        "local alpha evidence missing schema fixture validation check",
    )
    require(
        "local_alpha_service_presence" in check_ids,
        "local alpha evidence missing web/admin/backend presence check",
    )
    require(
        "local_alpha_runtime_stack" in check_ids,
        "local alpha evidence missing runtime stack check",
    )

    service_missing = local_alpha_service_missing()
    service_status = checks["local_alpha_service_presence"]["status"]
    if service_missing:
        require(
            service_status in {"fail", "blocked"},
            "local alpha service presence cannot pass while required web/admin/backend files are missing",
        )
    else:
        require(
            service_status == "pass",
            "local alpha service presence must pass when required web/admin/backend files exist",
        )

    runtime_status = checks["local_alpha_runtime_stack"]["status"]
    if local_alpha_runtime_stack_validated():
        require(
            runtime_status == "pass",
            "local alpha runtime stack evidence must pass when compose/env runtime files validate",
        )
    else:
        require(
            runtime_status in {"fail", "blocked"},
            "local alpha runtime stack cannot pass before docker compose and env evidence validate",
        )

    do_not_launch = {item["condition_id"]: item["is_present"] for item in data["do_not_launch_checks"]}
    require(
        do_not_launch.get("generic_workflow_only") is False,
        "release evidence must guard against generic workflow-only completion",
    )
    require(
        do_not_launch.get("missing_export_provenance_fixture") is False,
        "release evidence must guard against missing export provenance fixtures",
    )
    require(
        do_not_launch.get("missing_web_admin_backend_presence") is False,
        "release evidence must clear missing web/admin/backend do-not-launch condition when services are present",
    )
    require(
        do_not_launch.get("local_alpha_runtime_not_validated") is (not local_alpha_runtime_stack_validated()),
        "release evidence local_alpha_runtime_not_validated must reflect computed runtime validation state",
    )


def validate_blueprint_checklist() -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked_lines = {
        match.group(1)
        for match in re.finditer(r"^- \[x\] (.+)$", text, flags=re.MULTILINE)
    }
    missing = CHECKED_ITEMS - checked_lines
    require(not missing, f"blueprint missing completed fixture/schema checklist marks: {sorted(missing)}")

    forbidden = FORBIDDEN_CHECKED_ITEMS & checked_lines
    require(
        not forbidden,
        f"blueprint marks implementation items complete from lane6 fixture work: {sorted(forbidden)}",
    )

    for item, paths in CHECKLIST_FILE_EVIDENCE.items():
        if item in checked_lines:
            missing = missing_repo_paths(paths)
            require(
                not missing,
                f"blueprint marks {item!r} complete but required paths are missing: {missing}",
            )

    evidence = release_evidence_by_gate()
    for item, gate in GATE_CHECKLIST_ITEMS.items():
        if item in checked_lines:
            require(gate in evidence, f"blueprint marks {item!r} complete but no {gate} evidence exists")
            require(
                gate_allows_checklist_completion(evidence[gate]),
                f"blueprint marks {item!r} complete but {gate} evidence has blocked/failing checks or active do-not-launch conditions",
            )


def validate_local_alpha_presence() -> None:
    missing = local_alpha_service_missing()
    require(not missing, f"local alpha service presence missing required files: {missing}")


def validate_database_schema_artifacts() -> None:
    migrations = "\n".join(path.read_text(encoding="utf-8") for path in sorted(MIGRATION_DIR.glob("*.sql")))
    runner = (ROOT / "backend" / "cmd" / "migrate" / "main.go").read_text(encoding="utf-8")
    require("schema_migrations" in runner, "migration runner schema_migrations table must be present")
    require("forward-only" in migrations, "migrations must document forward-only policy")
    require("Rollback safety:" in migrations, "migrations must document rollback safety")
    require("Expand/contract policy:" in migrations, "migrations must document expand/contract policy")

    missing_tables = {
        table
        for table in DATABASE_TABLES
        if f"CREATE TABLE IF NOT EXISTS {table}" not in migrations
    }
    require(not missing_tables, f"database migrations missing tables: {sorted(missing_tables)}")

    missing_seed = {token for token in DATABASE_SEED_TOKENS if token not in migrations}
    require(not missing_seed, f"database migrations missing seed artifacts: {sorted(missing_seed)}")

    for token in ["progress", "retry_count", "timeout_at", "app_version", "worker_version", "schema_version"]:
        require(token in migrations, f"agent task migration missing {token}")

    for token in [
        "object_metadata_id text REFERENCES object_metadata(id)",
        "bucket text NOT NULL",
        "object_key text NOT NULL",
        "checksum text NOT NULL",
        "retention_until timestamptz",
        "manifest jsonb NOT NULL",
        "qa_status text NOT NULL",
        "token_hash text NOT NULL UNIQUE",
        "share_link_access_logs",
        "legal_metadata jsonb NOT NULL",
        "robots_policy jsonb NOT NULL",
        "provenance jsonb NOT NULL",
        "enforcement_points jsonb NOT NULL",
        "enforcement_point text NOT NULL",
        "qa_results",
    ]:
        require(token in migrations, f"database migrations missing contract token: {token}")


def validate_openapi_contract() -> None:
    require(OPENAPI.exists(), "missing openapi/zenart.v1.yaml")
    text = OPENAPI.read_text(encoding="utf-8")
    missing = {token for token in OPENAPI_REQUIRED_TOKENS if token not in text}
    require(not missing, f"OpenAPI contract missing required tokens: {sorted(missing)}")

    missing_contract_tokens = {token for token in OPENAPI_REQUIRED_CONTRACT_TOKENS if token not in text}
    require(
        not missing_contract_tokens,
        f"OpenAPI contract missing storage/export/share/crawler/safety tokens: {sorted(missing_contract_tokens)}",
    )

    operation_ids = set(re.findall(r"operationId: ([A-Za-z0-9_]+)", text))
    missing_operations = OPENAPI_REQUIRED_OPERATION_IDS - operation_ids
    require(not missing_operations, f"OpenAPI contract missing operations: {sorted(missing_operations)}")
    require(len(operation_ids) == len(re.findall(r"operationId: ", text)), "OpenAPI operationIds must be unique")

    for operation_id in [
        "listSupportTickets",
        "listExports",
        "listProviderStatus",
        "listProviderUsage",
        "listAbuseEvents",
        "listAuditLogs",
    ]:
        match = re.search(rf"operationId: {operation_id}\n(?P<body>(?:^      .+\n|^        .+\n|^          .+\n)+)", text, flags=re.MULTILINE)
        require(match is not None, f"OpenAPI operation {operation_id} missing operation block")
        body = match.group("body")
        require("x-rbac: admin" in body, f"{operation_id} must be admin scoped")
        require("PageToken" in body and "PageSize" in body, f"{operation_id} must define pagination parameters")

    mutating_blocks = re.findall(
        r"^    (post|put|patch|delete):\n(?P<body>(?:^      .+\n|^        .+\n|^          .+\n|^            .+\n|^              .+\n|^                .+\n|^                  .+\n)+)",
        text,
        flags=re.MULTILINE,
    )
    for method, body in mutating_blocks:
        operation_match = re.search(r"operationId: ([A-Za-z0-9_]+)", body)
        operation_id = operation_match.group(1) if operation_match else f"{method} operation"
        if operation_id == "deleteSession":
            continue
        require(
            "x-idempotency-required: true" in body and "$ref: \"#/components/parameters/IdempotencyKey\"" in body,
            f"{operation_id} must require idempotency key",
        )


def validate_openapi_rev2_domain_contracts() -> None:
    text = OPENAPI.read_text(encoding="utf-8")

    required_schema_fields = {
        "Upload": ["upload_url", "expires_at", "object_metadata"],
        "Asset": ["object_metadata", "provenance"],
        "Package": ["manifest", "qa_report", "provenance"],
        "Export": ["manifest", "qa_report", "provenance", "download_url"],
        "ShareLink": ["url", "access_policy"],
        "CrawlerSource": ["legal_metadata", "robots_policy"],
        "CrawlerFinding": ["provenance", "import_governance"],
        "SafetyRule": ["enforcement_points", "evaluation_contract"],
    }
    for schema_name, fields in required_schema_fields.items():
        pattern = rf"^    {schema_name}:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)"
        match = re.search(pattern, text, flags=re.MULTILINE | re.DOTALL)
        require(match is not None, f"OpenAPI schema {schema_name} missing")
        body = match.group("body")
        for field in fields:
            require(f"{field}:" in body, f"OpenAPI schema {schema_name} missing field {field}")
            require(
                re.search(rf"required: \[[^\]]*\b{re.escape(field)}\b", body) or re.search(
                    rf"^\s+- {re.escape(field)}$", body, flags=re.MULTILINE
                ),
                f"OpenAPI schema {schema_name} must require {field}",
            )

    for schema_name in ["Upload", "Export"]:
        match = re.search(
            rf"^    {schema_name}:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)",
            text,
            flags=re.MULTILINE | re.DOTALL,
        )
        body = match.group("body") if match else ""
        require("format: uri" in body, f"OpenAPI schema {schema_name} must expose signed URL fields as URI")

    share = re.search(r"^    ShareLink:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)", text, flags=re.MULTILINE | re.DOTALL)
    share_body = share.group("body") if share else ""
    require("token_hash:" in share_body, "ShareLink access_policy must return token_hash, not raw token")
    require("const: false" in share_body, "ShareLink must forbid direct object access")
    require("const: true" in share_body, "ShareLink must require audited access")

    crawler = re.search(r"^    CrawlerFinding:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)", text, flags=re.MULTILINE | re.DOTALL)
    crawler_body = crawler.group("body") if crawler else ""
    require("direct_activation_allowed:" in crawler_body, "CrawlerFinding must declare direct activation governance")
    require("provenance_links_required:" in crawler_body, "CrawlerFinding must require provenance links")
    require("admin_review_required:" in crawler_body, "CrawlerFinding must require admin review before import")

    safety = re.search(r"^    SafetyRule:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)", text, flags=re.MULTILINE | re.DOTALL)
    safety_body = safety.group("body") if safety else ""
    for point in SAFETY_POINTS:
        require(point in safety_body, f"SafetyRule enforcement_points missing {point}")
    require("uniqueItems: true" in safety_body, "SafetyRule enforcement_points must be unique")
    require("blocks_export_when_critical:" in safety_body, "SafetyRule must declare critical export blocking")


def validate_task_schema_compatibility_contract() -> None:
    task_go = ROOT / "backend" / "internal" / "task" / "task.go"
    task_test_go = ROOT / "backend" / "internal" / "task" / "task_test.go"
    server_go = ROOT / "backend" / "internal" / "server" / "server.go"
    server_test_go = ROOT / "backend" / "internal" / "server" / "server_test.go"

    require(task_go.exists(), "missing backend task contract implementation")
    require(task_test_go.exists(), "missing backend task schema compatibility tests")
    task_text = task_go.read_text(encoding="utf-8")
    task_test_text = task_test_go.read_text(encoding="utf-8")
    server_text = server_go.read_text(encoding="utf-8")
    server_test_text = server_test_go.read_text(encoding="utf-8")

    for token in [
        "type UnsupportedSchemaError struct",
        "TaskSchemaVersion int",
        "MaxSchemaVersion  int",
        "func CheckSchemaCompatibility",
    ]:
        require(token in task_text, f"task schema compatibility contract missing {token}")
    require("taskSchemaVersion > maxSchemaVersion" in task_text, "task schema compatibility must reject newer task schemas")
    require("CheckSchemaCompatibility(taskStatus.SchemaVersion, s.cfg.Tasks.SchemaVersion)" in server_text, "task status route must enforce schema compatibility")
    require("unsupported_task_schema" in server_text, "task status route must return unsupported_task_schema contract error")
    require("http.StatusConflict" in server_text, "unsupported task schema must be a conflict response")
    require("TestCheckSchemaCompatibilityRejectsNewerVersion" in task_test_text, "task schema compatibility tests must reject newer versions")
    require("TestTaskStatusRejectsUnsupportedSchemaVersion" in server_test_text, "server tests must cover unsupported task schema response")


def validate_generated_openapi_clients() -> None:
    for target in [
        ROOT / "web" / "lib" / "generated" / "zenart-api.ts",
        ROOT / "admin" / "lib" / "generated" / "zenart-api.ts",
    ]:
        require(target.exists(), f"missing generated client: {target.relative_to(ROOT)}")
        text = target.read_text(encoding="utf-8")
        require("Generated by scripts/generate_openapi_clients.py" in text, f"{target.relative_to(ROOT)} must be generated")
        require("ErrorEnvelope" in text, f"{target.relative_to(ROOT)} missing ErrorEnvelope")
        require("TaskStatus" in text, f"{target.relative_to(ROOT)} missing TaskStatus")

    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "generate_openapi_clients.py"), "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "generated OpenAPI clients are stale: " + (result.stderr or result.stdout).strip(),
    )


def validate_ops_ci_and_drill_evidence() -> None:
    for path in [CI_DRAFT, CI_INSTALLATION, ENVIRONMENT_EVIDENCE, DRILL_PLAN_EVIDENCE]:
        require(path.exists(), f"missing ops evidence file: {path.relative_to(ROOT)}")

    ci_text = CI_DRAFT.read_text(encoding="utf-8")
    required_ci_tokens = {
        "pull_request:",
        "branches:",
        "- main",
        "postgres:",
        "redis:",
        "minio:",
        "python3 scripts/generate_openapi_clients.py --check",
        "python3 scripts/validate_stage0_rev2.py",
        "go test ./...",
        "go vet ./...",
        "npm run lint",
        "npm run typecheck",
        "npm run test",
        "npm run build",
        "docker build --tag ghcr.io/alphane-ai/zenart-${{ matrix.image.name }}:${{ github.sha }}",
        "ops/evidence/stage0_environment_evidence.json",
    }
    missing_ci_tokens = {token for token in required_ci_tokens if token not in ci_text}
    require(not missing_ci_tokens, f"CI draft missing required coverage tokens: {sorted(missing_ci_tokens)}")

    installation = CI_INSTALLATION.read_text(encoding="utf-8")
    require(
        "Blocked by token scope" in installation and ".github/workflows/stage0-rev2-ci.yml" in installation,
        "CI installation checklist must keep workflow install blocked by token scope",
    )

    env = load_json(ENVIRONMENT_EVIDENCE)
    require(env["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "environment evidence must cite Rev2")
    require(env["created_by_lane"] == "lane5", "environment evidence must be lane5-owned")
    require(
        {item["name"] for item in env["environments"]} == {"local", "CI", "staging", "production"},
        "environment evidence must define local/CI/staging/production",
    )
    require(
        env["ci_draft"]["path"] == "ops/ci/stage0-rev2-ci.yml",
        "environment evidence must point at ops/ci CI draft",
    )
    open_items = {item["id"]: item for item in env["open_items"]}
    require(
        open_items.get("install_github_actions_workflow", {}).get("status") == "blocked_by_token_scope",
        "workflow installation must remain blocked_by_token_scope",
    )
    require("playwright_smoke" in open_items, "environment evidence must keep Playwright smoke open")

    drill = load_json(DRILL_PLAN_EVIDENCE)
    require(drill["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "drill plan must cite Rev2")
    require(drill["created_by_lane"] == "lane5", "drill plan must be lane5-owned")
    require(
        drill["backup_restore"]["script"] == "scripts/backup_restore_drill.sh",
        "drill plan must cite backup restore script",
    )
    require(
        drill["load"]["script"] == "scripts/load_smoke.sh",
        "drill plan must cite load smoke script",
    )
    require(
        {
            "chat_task",
            "worker_generation",
            "zip_export",
            "signed_download",
            "crawler_throttle",
            "quota_contention",
            "workspace_rendering",
        }
        <= set(drill["load"]["modes"]),
        "drill plan missing required load modes",
    )


def main() -> int:
    checks = [
        validate_json_files,
        validate_schema_fixture_contracts,
        validate_provenance,
        validate_ops_ci_artifact_evidence,
        validate_workflows,
        validate_eval_suite,
        validate_qa_and_safety,
        validate_crawler_feedback_abuse,
        validate_local_alpha_presence,
        validate_release_gate_evidence,
        validate_blueprint_checklist,
        validate_database_schema_artifacts,
        validate_openapi_contract,
        validate_openapi_rev2_domain_contracts,
        validate_task_schema_compatibility_contract,
        validate_generated_openapi_clients,
        validate_ops_ci_and_drill_evidence,
    ]
    try:
        for check in checks:
            check()
    except ValidationError as exc:
        print(f"stage0 rev2 validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage0 rev2 validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
