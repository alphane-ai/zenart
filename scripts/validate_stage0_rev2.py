#!/usr/bin/env python3
"""Validate Stage 0 Rev2 fixture/provenance/release-gate basics."""

from __future__ import annotations

import json
import hashlib
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
CI_WORKFLOW_REL = ".github/workflows/stage0-rev2-ci.yml"
CI_DRAFT_REL = "ops/ci/stage0-rev2-ci.yml"
CI_INSTALLATION = ROOT / "ops" / "ci" / "INSTALLATION.md"
CI_DRAFT_EVIDENCE = OPS_FIXTURE_DIR / "stage0_rev2_ci_draft_evidence.json"
ENVIRONMENT_EVIDENCE = ROOT / "ops" / "evidence" / "stage0_environment_evidence.json"
DRILL_PLAN_EVIDENCE = ROOT / "ops" / "evidence" / "stage0_drill_plan.json"
OBSERVABILITY_EVIDENCE = ROOT / "ops" / "evidence" / "stage0_observability_evidence.json"
RELEASE_OPS_EVIDENCE = ROOT / "ops" / "evidence" / "stage0_release_ops_evidence.json"
STAGING_SUPPORT_RETRY_ABUSE_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "20260527T1000Z-support-retry-abuse.json"
STAGING_AUTH_RBAC_TENANT_AUDIT_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260527T1515Z-auth-rbac-tenant-audit.json"
)
STAGING_BRIEF_UPLOAD_CONFIRMATION_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260526T2330Z-brief-upload-confirmation.json"
)
STAGING_BACKEND_WORKER_CRAWLER_METRICS_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260527T1215Z-backend-worker-crawler-metrics.json"
)
STAGING_OBSERVABILITY_TELEMETRY_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260527T1815Z-observability-telemetry.json"
)
STAGING_OBSERVABILITY_RUNTIME_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260527T1830Z-observability-runtime.json"
)
STAGING_OBSERVABILITY_RUNTIME_CHECKLIST_ITEM = (
    "Private Beta/Staging observability runtime evidence 通过：staging evidence proves "
    "request-id、structured logs、OpenTelemetry traces、backend/worker/crawler metrics、dashboard import、"
    "alert routes in `ops/evidence/staging/20260527T1830Z-observability-runtime.json`; this "
    "observability-only artifact preserved backup/restore、load、post-deploy smoke blockers until the "
    "later combined preflight closed them。"
)
PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_CHECKLIST_ITEM = (
    "Production backup/rollback/incident/post-deploy admin-visible probe evidence recorded but launch blocker preserved: "
    "`ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json` has "
    "`status=blocked_by_upstream_gates`, proves backup、rollback、incident、post-deploy smoke probes, "
    "and cannot close production backup/rollback launch readiness until upstream CI/Staging gates and exact split files pass。"
)
PRODUCTION_POST_DEPLOY_LAUNCH_CLEARING_CHECKLIST_ITEM = (
    "Production post-deploy launch-clearing smoke evidence 通过：exact production split evidence exists at "
    "`ops/evidence/production/rollback-incident-post-deploy-smoke.json`, cites passing CI and Private Beta/Staging "
    "gate fixtures, and clears `production_deploy_rollback_smoke_missing` without preserved blockers。"
)
STAGING_EVAL_QA_SAFETY_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260527T1900Z-eval-qa-safety.json"
)
STAGING_OBSERVABILITY_BACKUP_LOAD_PREFLIGHT_EVIDENCE = (
    ROOT
    / "ops"
    / "evidence"
    / "staging"
    / "20260527T013207Z-staging-observability-backup-load-36222.json"
)
STAGING_OBJECT_STORAGE_SIGNED_URL_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260527T2130Z-object-storage-signed-url.json"
)
STAGING_LEGAL_SUPPORT_VISIBILITY_SCRIPT = ROOT / "scripts" / "staging_legal_support_visibility_smoke.sh"
STAGING_QUOTA_RATE_LIMIT_SPEND_CAP_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260527T2015Z-quota-rate-limit-spend-cap.json"
)
STAGING_OBJECT_STORAGE_RETENTION_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "object-storage-retention-cleanup.json"
)
STAGING_LEGAL_EXTERNAL_PAGES_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "legal-pages-external-user.json"
)
STAGING_SUPPORT_CONTACT_VISIBILITY_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "support-contact-external-user.json"
)
PRODUCTION_ABUSE_THROTTLE_HOLD_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "20260527T1330Z-abuse-throttle-hold.json"
)
PRODUCTION_ACTIVATION_REVIEW_AUDIT_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "20260527T1430Z-activation-review-audit.json"
)
PRODUCTION_SKILL_RELEASE_EVAL_CANARY_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "20260527T1600Z-skill-release-eval-canary.json"
)
PRODUCTION_SECURITY_LAUNCH_CHECKS_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "20260527T1700Z-security-launch-checks.json"
)
PRODUCTION_PROVIDER_MODE_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "provider-mode.json"
)
PRODUCTION_CLAIMS_ALIGNMENT_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "public-paid-real-generation-claims.json"
)
PRODUCTION_BILLING_LIFECYCLE_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "billing-lifecycle.json"
)
PRODUCTION_BILLING_IDEMPOTENCY_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "billing-refund-credit-webhook.json"
)
PRODUCTION_BACKUP_RESTORE_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "backup-restore.json"
)
PRODUCTION_ROLLBACK_INCIDENT_SMOKE_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "rollback-incident-post-deploy-smoke.json"
)
PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "20260527T1800Z-backup-rollback-incident-smoke.json"
)
PRODUCTION_LEGAL_POLICY_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "public-legal-policy.json"
)
PRODUCTION_SUPPORT_BILLING_POLICY_EVIDENCE = (
    ROOT / "ops" / "evidence" / "production" / "public-support-billing-policy.json"
)
OBSERVABILITY_DASHBOARD = ROOT / "ops" / "observability" / "dashboards" / "stage0_rev2_overview.json"
OBSERVABILITY_ALERTS = ROOT / "ops" / "observability" / "alerts" / "stage0_rev2_alerts.json"
STAGING_DASHBOARD_RUNTIME_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260526T1000Z-dashboard-runtime.json"
)
STAGING_ALERT_RUNTIME_EVIDENCE = (
    ROOT / "ops" / "evidence" / "staging" / "20260526T1000Z-alert-runtime.json"
)

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

QA_CATEGORIES = {
    "file_integrity",
    "dimensions",
    "aspect_ratio",
    "safe_area",
    "blank_output",
    "duplicate_similarity",
    "four_option_distinctness",
    "text_readability",
    "structured_text",
    "product_logo_preservation",
    "forbidden_claims",
    "watermark_signature_risk",
    "export_completeness",
}

QA_CATEGORY_ORDER = [
    "file_integrity",
    "dimensions",
    "aspect_ratio",
    "safe_area",
    "blank_output",
    "duplicate_similarity",
    "four_option_distinctness",
    "text_readability",
    "structured_text",
    "product_logo_preservation",
    "forbidden_claims",
    "watermark_signature_risk",
    "export_completeness",
]

DIMENSION_QA_CATEGORIES = {
    "four_option_distinctness": {"four_option_distinctness"},
    "image_qa": {
        "file_integrity",
        "dimensions",
        "aspect_ratio",
        "safe_area",
        "blank_output",
        "duplicate_similarity",
        "watermark_signature_risk",
    },
    "text_readability": {"text_readability"},
    "product_logo_preservation": {"product_logo_preservation"},
    "package_export_completeness": {"export_completeness"},
}

SUMMARY_PROJECTION_FIELDS = {
    "total_fixtures",
    "passed_fixtures",
    "failed_fixtures",
    "blocked_fixtures",
    "golden_passed",
    "critical_safety_regressions",
    "regression_pass_rate",
    "trace_complete",
    "export_contract_complete",
    "qa_fixture_coverage_complete",
    "qa_categories_covered",
    "safety_enforcement_points_covered",
}

LATEST_ONLY_GROUP_FIELDS = {
    "tenant_id",
    "eval_suite_id",
    "subject_type",
    "subject_id",
    "subject_version",
    "runner_sha256",
}

EVAL_READ_QUERY_FILTERS = {
    "tenant_id",
    "eval_suite_id",
    "subject_type",
    "subject_id",
    "subject_version",
    "status",
    "completed_after",
    "latest_only",
    "page_token",
    "page_size",
}

FIXTURE_RESULT_PROJECTION_FIELDS = {
    "fixture_id",
    "category",
    "workflow",
    "status",
    "expected_safety_action",
    "observed_safety_action",
    "safety_decision_contract",
    "qa_check_ids",
    "qa_coverage_contract",
    "trace_contract",
    "export_contract",
    "qa_export_gate",
    "failure_reasons",
}

SAFETY_ACTION_PRIORITY = {
    "allow": 0,
    "warn": 1,
    "require_user_confirmation": 2,
    "require_admin_review": 3,
    "block": 4,
}

SAFETY_EXPORT_GATE_EFFECT = {
    "allow": "allow_when_export_contract_complete",
    "warn": "allow_with_warning",
    "require_user_confirmation": "hold_until_user_confirmation",
    "require_admin_review": "hold_until_admin_review",
    "block": "block_final_export",
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

GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM = "Do-Not-Launch Conditions 全部为 false。"

CHECK_STATUS_VALUES = {"pass", "fail", "blocked", "not_applicable"}
REQUIRED_RELEASE_GATE_CHECK_STATUS_VALUES = {"pass", "fail", "blocked"}
RUNTIME_PASS_EVIDENCE_STATUS_VALUES = {"pass", "passed", "pass_with_blockers_preserved"}

BLOCKED_RUNTIME_EVIDENCE_TERMS = {
    "absent",
    "missing",
    "not present",
    "cannot pass until",
    "requires",
    "remain",
    "未",
    "缺",
    "open",
}

BLOCKED_GATE_EVIDENCE_TERMS = {
    "runtime evidence",
    "deployment evidence",
    "installed PR/main workflow",
    "staging evidence",
    "production evidence",
    "post-deploy smoke",
    "real production provider",
    "invite/comp-only",
    "comp-only production mode",
    "external-user",
    "running web/admin/backend",
    "workflow scope",
}

SPLIT_EVIDENCE_PRESENT_TERMS = (
    "passed",
    "present",
    "validates",
    "proves",
    "通过",
    "存在",
)

SPLIT_EVIDENCE_ABSENT_TERMS = (
    "absent",
    "missing",
    "not present",
    "does not exist",
    "still required",
    "remains missing",
    "remains absent",
    "未",
    "缺",
    "缺失",
)

RELEASE_GATE_REQUIRED_CHECKS = {
    "local_alpha": {
        "workflow_fixture_coverage",
        "eval_fixture_coverage",
        "crawler_governance_fixture_coverage",
        "schema_fixture_validation",
        "local_alpha_service_presence",
        "local_alpha_runtime_stack",
        "local_alpha_e2e_workflow_smoke",
    },
    "ci": {
        "ci_draft_artifact_coverage",
        "ci_installed_workflow",
        "ci_gate_runtime_execution",
        "ci_playwright_smoke",
        "ci_docker_image_build",
    },
    "private_beta_staging": {
        "staging_auth_rbac_tenant_audit",
        "staging_brief_upload_confirmation",
        "staging_object_storage_signed_downloads",
        "staging_quota_rate_limit_spend_cap",
        "staging_support_retry_abuse_ops",
        "staging_eval_qa_safety_runtime",
        "staging_crawler_approval_provenance",
        "staging_observability_backup_load",
        "staging_legal_external_user_pages",
    },
    "production_launch": {
        "production_provider_or_comp_only_mode",
        "production_paid_billing_lifecycle",
        "production_skill_release_eval_canary",
        "production_activation_review_audit",
        "production_abuse_throttle_hold",
        "production_security_launch_checks",
        "production_backup_rollback_incident",
        "production_legal_support_policy",
    },
}

RELEASE_GATE_REQUIRED_ACTIVE_CONDITIONS = {
    "local_alpha": set(),
    "ci": {
        "ci_workflow_not_installed",
        "ci_gate_not_executed_on_main",
        "ci_playwright_smoke_missing",
        "ci_docker_image_build_missing",
    },
    "private_beta_staging": {
        "tenant_isolation_not_enforced",
        "staging_brief_upload_confirmation_runtime_missing",
        "object_storage_signed_retention_runtime_missing",
        "rate_limit_spend_cap_runtime_missing",
        "eval_qa_safety_runtime_missing",
        "staging_observability_restore_load_missing",
        "external_user_legal_pages_missing",
    },
    "production_launch": {
        "dev_mock_provider_public_claims_unresolved",
        "real_provider_or_comp_only_mode_missing",
        "paid_billing_or_comp_only_mode_missing",
        "skill_release_eval_canary_missing",
        "activation_eval_review_audit_runtime_missing",
        "admin_high_risk_review_runtime_missing",
        "abuse_throttle_hold_missing",
        "security_privacy_legal_incomplete",
        "secret_exposure_runtime_not_verified",
        "backup_restore_rollback_smoke_missing",
        "production_deploy_rollback_smoke_missing",
        "public_legal_support_policy_not_deployed",
        "ci_staging_gates_not_passed",
    },
}

RELEASE_GATE_EVIDENCE_FILES = {
    "local_alpha": FIXTURE_DIR / "release_gate_evidence.local_alpha.json",
    "ci": FIXTURE_DIR / "release_gate_evidence.ci.json",
    "private_beta_staging": FIXTURE_DIR / "release_gate_evidence.private_beta_staging.json",
    "production_launch": FIXTURE_DIR / "release_gate_evidence.production_launch.json",
}

RELEASE_GATE_EVIDENCE_IDS = {
    "local_alpha": "gate_local_alpha_fixture_baseline",
    "ci": "gate_ci_draft_blocked",
    "private_beta_staging": "gate_private_beta_staging_blocked",
    "production_launch": "gate_production_launch_blocked",
}

RELEASE_GATE_BACKFILL_CHECKED_ITEMS = {
    "Backfill Local Alpha release gate fixture evidence: workflow/eval/crawler/schema/service/runtime-stack checks pass in `fixtures/stage0/rev2/release_gate_evidence.local_alpha.json`。",
    "Backfill CI draft/no-go evidence: ops CI draft coverage passes while installed `.github/workflows` runtime remains blocked in `fixtures/stage0/rev2/release_gate_evidence.ci.json`。",
    "Backfill Private Beta/Staging no-go evidence: contract/fixture evidence is separated from external-user staging runtime blockers in `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json`。",
    "Backfill Production Launch no-go evidence: provider/billing/skill/activation/abuse/security/backup/legal blockers remain active in `fixtures/stage0/rev2/release_gate_evidence.production_launch.json`。",
}

RELEASE_GATE_RUNTIME_OPEN_ITEMS = {
    "Local Alpha workflow API/Playwright end-to-end smoke evidence 通过并写入 release gate fixture。",
    "CI installed workflow runtime evidence 通过：PR/main run、Playwright smoke、Docker image build 均有 validator-resolvable evidence。",
    "Private Beta/Staging external-user runtime evidence 通过：auth/RBAC/tenant、storage、quota/rate limit、support/abuse、safety/QA/crawler、observability/backup/load、legal visibility 均有 staging evidence。",
    "Production Launch runtime/deployment evidence 通过：provider-or-comp-only、paid lifecycle、skill canary、activation audit、abuse hold、security、backup/rollback/post-deploy smoke、legal/support policy 均有 production evidence。",
}

CI_RUNTIME_OPEN_CHECK_ITEMS = {
    "CI installed workflow file evidence 通过：`.github/workflows/stage0-rev2-ci.yml` 存在且被 release gate fixture 引用。": {
        "ci_installed_workflow",
    },
    "CI PR/main workflow run evidence 通过：已安装 workflow 的 PR/main run 结果写入 `ops/evidence/ci/`。": {
        "ci_gate_runtime_execution",
    },
    "CI Playwright smoke runtime evidence 通过：已安装 PR/main workflow 运行 Playwright smoke 并写入 `ops/evidence/ci/`。": {
        "ci_playwright_smoke",
    },
    "CI Docker image build runtime evidence 通过：已安装 PR/main workflow build Docker images 并写入 `ops/evidence/ci/`。": {
        "ci_docker_image_build",
    },
}

RUNTIME_GATE_CHECK_IDS = {
    "local_alpha": {"local_alpha_e2e_workflow_smoke"},
    "ci": {
        "ci_installed_workflow",
        "ci_gate_runtime_execution",
        "ci_playwright_smoke",
        "ci_docker_image_build",
    },
    "private_beta_staging": RELEASE_GATE_REQUIRED_CHECKS["private_beta_staging"],
    "production_launch": RELEASE_GATE_REQUIRED_CHECKS["production_launch"],
}

DEFINITION_ONLY_EVIDENCE_RE = re.compile(
    r"("
    r"Docs/stage0_blueprint_rev2\.md|"
    r"README\.md|"
    r"schemas/stage0/rev2|"
    r"fixtures/stage0/rev2/(?:workflows|eval|crawler|feedback|abuse|analytics)|"
    r"fixtures/ops/stage0_rev2_ci_draft_evidence\.json|"
    r"ops/ci/|"
    r"ops/release/release_notes_template\.md"
    r")"
)

RUNTIME_EVIDENCE_RE = re.compile(
    r"("
    r"\.github/workflows/|"
    r"ops/evidence/|"
    r"ops/release/stage0_rev2_current_no_go_release_notes\.md|"
    r"scripts/(?:playwright_smoke|docker_build_smoke|staging_smoke|backup_restore_drill|load_smoke|observability_smoke|security_scan_smoke)\.sh|"
    r"backend/|"
    r"web/|"
    r"admin/|"
    r"docker-compose\.yml|"
    r"\.env\.example"
    r")"
)

RUNTIME_PASS_REQUIREMENTS = {
    ("local_alpha", "local_alpha_e2e_workflow_smoke"): {
        "path_patterns": (r"ops/evidence/(?:local_alpha|local)/",),
        "tokens": (
            "workflow",
            "smoke",
            "api",
            "playwright",
            "brief",
            "4 candidates",
            "select",
            "iterate",
            "package",
            "export zip",
        ),
    },
    ("ci", "ci_installed_workflow"): {
        "path_patterns": (re.escape(CI_WORKFLOW_REL),),
        "tokens": ("stage0-rev2-ci",),
    },
    ("ci", "ci_gate_runtime_execution"): {
        "path_patterns": (r"ops/evidence/ci/",),
        "tokens": ("pr/main", "run"),
    },
    ("ci", "ci_playwright_smoke"): {
        "path_patterns": (r"ops/evidence/ci/",),
        "tokens": ("playwright",),
    },
    ("ci", "ci_docker_image_build"): {
        "path_patterns": (r"ops/evidence/ci/",),
        "tokens": ("docker",),
    },
    ("private_beta_staging", "staging_auth_rbac_tenant_audit"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "auth", "rbac", "tenant", "audit"),
    },
    ("private_beta_staging", "staging_brief_upload_confirmation"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "brief", "upload", "confirmation"),
    },
    ("private_beta_staging", "staging_object_storage_signed_downloads"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "object storage", "signed", "download", "retention", "cross-tenant"),
    },
    ("private_beta_staging", "staging_quota_rate_limit_spend_cap"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "quota", "rate limit", "spend cap"),
    },
    ("private_beta_staging", "staging_support_retry_abuse_ops"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "support", "retry", "abuse"),
    },
    ("private_beta_staging", "staging_eval_qa_safety_runtime"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "eval", "qa", "safety", "brief", "provider request", "provider response", "export"),
    },
    ("private_beta_staging", "staging_crawler_approval_provenance"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "crawler", "approval", "provenance", "robots", "ssrf", "blocklist"),
    },
    ("private_beta_staging", "staging_observability_backup_load"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "logs", "metrics", "traces", "alerts", "dashboard", "backup", "restore", "load"),
    },
    ("private_beta_staging", "staging_legal_external_user_pages"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "external user", "terms", "privacy", "acceptable use", "support", "ai/content", "ip complaint"),
    },
    ("production_launch", "production_provider_or_comp_only_mode"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "provider", "real", "cost", "monitoring", "comp-only"),
    },
    ("production_launch", "production_paid_billing_lifecycle"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "checkout", "subscription", "cancellation", "past_due", "quota reset", "webhook"),
    },
    ("production_launch", "production_skill_release_eval_canary"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "skill", "eval", "canary", "release notes", "rollback", "audit"),
    },
    ("production_launch", "production_activation_review_audit"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "activation", "eval", "review", "audit"),
    },
    ("production_launch", "production_abuse_throttle_hold"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "abuse", "throttle", "hold"),
    },
    ("production_launch", "production_security_launch_checks"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "security", "secure session", "csrf", "secret", "admin surface privacy"),
    },
    ("production_launch", "production_backup_rollback_incident"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "backup", "restore", "rollback", "incident", "post-deploy smoke"),
    },
    ("production_launch", "production_legal_support_policy"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "terms", "privacy", "acceptable use", "support", "ai/content", "ip complaint"),
    },
}

RUNTIME_BLOCKED_EVIDENCE_REQUIREMENTS = {
    ("local_alpha", "local_alpha_e2e_workflow_smoke"): {
        "path_patterns": (r"ops/evidence/(?:local_alpha|local)/",),
        "tokens": ("workflow", "api", "playwright", "export"),
    },
    ("ci", "ci_installed_workflow"): {
        "path_patterns": (re.escape(CI_WORKFLOW_REL),),
        "tokens": ("workflow",),
    },
    ("ci", "ci_gate_runtime_execution"): {
        "path_patterns": (r"\.github/workflows/", r"ops/evidence/ci/"),
        "tokens": ("pr/main", "run"),
    },
    ("ci", "ci_playwright_smoke"): {
        "path_patterns": (r"ops/evidence/ci/",),
        "tokens": ("playwright",),
    },
    ("ci", "ci_docker_image_build"): {
        "path_patterns": (r"ops/evidence/ci/",),
        "tokens": ("docker",),
    },
    ("private_beta_staging", "staging_object_storage_signed_downloads"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "object storage", "signed", "retention"),
    },
    ("private_beta_staging", "staging_quota_rate_limit_spend_cap"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "quota", "rate", "spend"),
    },
    ("private_beta_staging", "staging_eval_qa_safety_runtime"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "eval", "qa", "safety"),
    },
    ("private_beta_staging", "staging_observability_backup_load"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "restore", "load"),
    },
    ("private_beta_staging", "staging_legal_external_user_pages"): {
        "path_patterns": (r"ops/evidence/staging/",),
        "tokens": ("staging", "external-user", "legal"),
    },
    ("production_launch", "production_provider_or_comp_only_mode"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "provider", "comp-only"),
    },
    ("production_launch", "production_paid_billing_lifecycle"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "billing", "lifecycle"),
    },
    ("production_launch", "production_backup_rollback_incident"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "backup", "rollback", "post-deploy"),
    },
    ("production_launch", "production_legal_support_policy"): {
        "path_patterns": (r"ops/evidence/production/",),
        "tokens": ("production", "legal", "support"),
    },
}

RUNTIME_PASS_FILE_PREFIXES = {
    "local_alpha": ("ops/evidence/local_alpha/", "ops/evidence/local/"),
    "ci": (".github/workflows/", "ops/evidence/ci/"),
    "private_beta_staging": ("ops/evidence/staging/",),
    "production_launch": ("ops/evidence/production/",),
}

RUNTIME_PASS_FILE_ENVIRONMENTS = {
    "local_alpha": {"local", "local_alpha"},
    "ci": {"ci"},
    "private_beta_staging": {"staging"},
    "production_launch": {"production"},
}

RUNTIME_PASS_EVIDENCE_FILES = {
    ("private_beta_staging", "staging_auth_rbac_tenant_audit"): [
        STAGING_AUTH_RBAC_TENANT_AUDIT_EVIDENCE,
    ],
    ("private_beta_staging", "staging_brief_upload_confirmation"): [
        STAGING_BRIEF_UPLOAD_CONFIRMATION_EVIDENCE,
    ],
    ("private_beta_staging", "staging_quota_rate_limit_spend_cap"): [
        STAGING_QUOTA_RATE_LIMIT_SPEND_CAP_EVIDENCE,
    ],
    ("private_beta_staging", "staging_support_retry_abuse_ops"): [
        STAGING_SUPPORT_RETRY_ABUSE_EVIDENCE,
    ],
    ("private_beta_staging", "staging_eval_qa_safety_runtime"): [
        STAGING_EVAL_QA_SAFETY_EVIDENCE,
    ],
    ("private_beta_staging", "staging_crawler_approval_provenance"): [
        ROOT / "ops" / "evidence" / "staging" / "20260527T1100Z-crawler-governance-runtime.json",
    ],
    ("private_beta_staging", "staging_observability_backup_load"): [
        STAGING_OBSERVABILITY_BACKUP_LOAD_PREFLIGHT_EVIDENCE,
    ],
    ("private_beta_staging", "staging_object_storage_signed_downloads"): [
        STAGING_OBJECT_STORAGE_SIGNED_URL_EVIDENCE,
        STAGING_OBJECT_STORAGE_RETENTION_EVIDENCE,
    ],
    ("private_beta_staging", "staging_legal_external_user_pages"): [
        STAGING_LEGAL_EXTERNAL_PAGES_EVIDENCE,
        STAGING_SUPPORT_CONTACT_VISIBILITY_EVIDENCE,
    ],
    ("production_launch", "production_provider_or_comp_only_mode"): [
        PRODUCTION_PROVIDER_MODE_EVIDENCE,
        PRODUCTION_CLAIMS_ALIGNMENT_EVIDENCE,
    ],
    ("production_launch", "production_paid_billing_lifecycle"): [
        PRODUCTION_BILLING_LIFECYCLE_EVIDENCE,
        PRODUCTION_BILLING_IDEMPOTENCY_EVIDENCE,
    ],
    ("production_launch", "production_activation_review_audit"): [
        PRODUCTION_ACTIVATION_REVIEW_AUDIT_EVIDENCE,
    ],
    ("production_launch", "production_abuse_throttle_hold"): [
        PRODUCTION_ABUSE_THROTTLE_HOLD_EVIDENCE,
    ],
    ("production_launch", "production_skill_release_eval_canary"): [
        PRODUCTION_SKILL_RELEASE_EVAL_CANARY_EVIDENCE,
    ],
    ("production_launch", "production_security_launch_checks"): [
        PRODUCTION_SECURITY_LAUNCH_CHECKS_EVIDENCE,
    ],
    ("production_launch", "production_backup_rollback_incident"): [
        PRODUCTION_BACKUP_RESTORE_EVIDENCE,
        PRODUCTION_ROLLBACK_INCIDENT_SMOKE_EVIDENCE,
    ],
    ("production_launch", "production_legal_support_policy"): [
        PRODUCTION_LEGAL_POLICY_EVIDENCE,
        PRODUCTION_SUPPORT_BILLING_POLICY_EVIDENCE,
    ],
}

RUNTIME_EVIDENCE_CHECKLIST_ITEMS = {
    ("private_beta_staging", "staging_auth_rbac_tenant_audit"): {
        "Private Beta/Staging auth/RBAC/tenant/audit runtime evidence 通过。",
    },
    ("private_beta_staging", "staging_brief_upload_confirmation"): {
        "Private Beta/Staging brief/upload/confirmation runtime evidence 通过。",
    },
    ("private_beta_staging", "staging_quota_rate_limit_spend_cap"): {
        "Private Beta/Staging quota/rate-limit/spend-cap runtime evidence 通过。",
    },
    ("private_beta_staging", "staging_support_retry_abuse_ops"): {
        "Private Beta/Staging support/retry/abuse runtime evidence 通过。",
    },
    ("private_beta_staging", "staging_eval_qa_safety_runtime"): {
        "Private Beta/Staging eval/QA/safety enforcement runtime evidence 通过。",
    },
    ("private_beta_staging", "staging_crawler_approval_provenance"): {
        "staging crawler fetch/import governance runtime evidence 通过：source approval、robots、SSRF、rate limits、retention、exact-text warning、provenance links、source blocklist 均有 staging evidence。",
    },
    ("private_beta_staging", "staging_observability_backup_load"): {
        "Private Beta/Staging observability/backup/load runtime evidence 通过。",
        "Private Beta/Staging observability runtime evidence 通过：staging evidence proves request-id、structured logs、OpenTelemetry traces、backend/worker/crawler metrics、dashboard import、alert routes in `ops/evidence/staging/20260527T1830Z-observability-runtime.json`; this observability-only artifact preserved backup/restore、load、post-deploy smoke blockers until the later combined preflight closed them。",
        "Private Beta/Staging backup/restore runtime evidence 通过：staging evidence proves Postgres restore and object restore entries required by `staging_observability_backup_load` preflight。",
        "Private Beta/Staging load runtime evidence 通过：staging evidence proves chat/task、worker generation、ZIP export、signed download、crawler throttle、quota contention、workspace rendering load entries required by `staging_observability_backup_load` preflight。",
        "Staging post-deploy smoke tests 通过。",
    },
    ("private_beta_staging", "staging_object_storage_signed_downloads"): {
        "Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。",
        "Private Beta/Staging object retention/cleanup runtime evidence 通过：staging evidence proves retention policy, expired export cleanup, orphan cleanup, and audit refs under `ops/evidence/staging/`。",
    },
    ("private_beta_staging", "staging_legal_external_user_pages"): {
        "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。",
        "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
        "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。",
    },
    ("production_launch", "production_provider_or_comp_only_mode"): {
        "Production provider mode deployment evidence 通过：production evidence proves either real provider contract/monitoring/cost/staging verification or explicit invite/comp-only mode under `ops/evidence/production/`。",
        "Production public paid/real-generation claims evidence 通过：production evidence proves paid and real-generation claims are enabled only with real provider evidence, or hidden for invite/comp-only mode under `ops/evidence/production/`。",
    },
    ("production_launch", "production_paid_billing_lifecycle"): {
        "Production checkout/subscription/cancellation/past_due runtime evidence 通过 under `ops/evidence/production/`。",
        "Production refund/credit/quota reset/webhook idempotency runtime evidence 通过 under `ops/evidence/production/`。",
    },
    ("production_launch", "production_activation_review_audit"): {
        "Production activation review/audit runtime/deployment evidence 通过。",
    },
    ("production_launch", "production_abuse_throttle_hold"): {
        "Production abuse throttle/hold runtime/deployment evidence 通过。",
    },
    ("production_launch", "production_skill_release_eval_canary"): {
        "Production skill release/eval/canary runtime/deployment evidence 通过。",
    },
    ("production_launch", "production_security_launch_checks"): {
        "Production security launch-check runtime/deployment evidence 通过。",
    },
    ("production_launch", "production_backup_rollback_incident"): {
        "Production backup/restore runtime evidence 通过：production evidence proves backup schedule, Postgres restore, object restore, RPO/RTO, and audit refs under `ops/evidence/production/`。",
        "Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves rollback drill, incident/alert path, migration compatibility, and post-deploy smoke under `ops/evidence/production/`。",
    },
    ("production_launch", "production_legal_support_policy"): {
        "Production public legal policy deployment evidence 通过：production evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow visibility under `ops/evidence/production/`。",
        "Production public support/billing policy deployment evidence 通过：production evidence proves support contact and paid billing/cancellation/refund policy visibility under `ops/evidence/production/`。",
    },
}

GATE_IMPACT_KEY_CHECKLIST_ITEMS = {
    "can_clear_crawler_governance_runtime_checklist_item": "staging crawler fetch/import governance runtime evidence 通过：source approval、robots、SSRF、rate limits、retention、exact-text warning、provenance links、source blocklist 均有 staging evidence。",
    "can_clear_legal_pages_subitem": "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
    "can_clear_support_contact_subitem": "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。",
    "can_clear_signed_url_checklist_item": "Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。",
}

PARTIAL_RUNTIME_PASS_EVIDENCE_ALLOWLIST = {
    "ops/evidence/staging/20260527T1215Z-backend-worker-crawler-metrics.json",
    "ops/evidence/staging/20260527T1815Z-observability-telemetry.json",
    "ops/evidence/staging/20260527T1830Z-observability-runtime.json",
    "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
    "ops/evidence/staging/20260526T2330Z-brief-upload-confirmation.json",
    "ops/evidence/staging/20260527T1100Z-crawler-governance-runtime.json",
    "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
    "ops/evidence/staging/20260527T1900Z-eval-qa-safety.json",
    "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
    "ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json",
    "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json",
    "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
    "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
    "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
}

RUNTIME_SPLIT_PASS_REQUIREMENTS = {
    ("private_beta_staging", "staging_object_storage_signed_downloads"): {
        "subitems": {
            "signed_url": STAGING_OBJECT_STORAGE_SIGNED_URL_EVIDENCE,
            "retention_cleanup": STAGING_OBJECT_STORAGE_RETENTION_EVIDENCE,
        },
        "tokens": {
            "signed_url": ("signed", "download", "expiry", "direct-object denial", "cross-tenant"),
            "retention_cleanup": ("retention", "expired export cleanup", "orphan cleanup", "audit"),
        },
    },
    ("private_beta_staging", "staging_legal_external_user_pages"): {
        "subitems": {
            "legal_pages": STAGING_LEGAL_EXTERNAL_PAGES_EVIDENCE,
            "support_contact": STAGING_SUPPORT_CONTACT_VISIBILITY_EVIDENCE,
        },
        "tokens": {
            "legal_pages": ("terms", "privacy", "acceptable use", "ai/content", "ip complaint"),
            "support_contact": ("support", "report-problem", "external user"),
        },
    },
    ("production_launch", "production_provider_or_comp_only_mode"): {
        "subitems": {
            "provider_mode": PRODUCTION_PROVIDER_MODE_EVIDENCE,
            "claims_alignment": PRODUCTION_CLAIMS_ALIGNMENT_EVIDENCE,
        },
        "tokens": {
            "provider_mode": ("real provider", "monitoring", "cost", "staging verification", "comp-only"),
            "claims_alignment": ("paid", "real-generation", "claims", "hidden", "comp-only"),
        },
    },
    ("production_launch", "production_paid_billing_lifecycle"): {
        "subitems": {
            "checkout_subscription": PRODUCTION_BILLING_LIFECYCLE_EVIDENCE,
            "refund_credit_webhook": PRODUCTION_BILLING_IDEMPOTENCY_EVIDENCE,
        },
        "tokens": {
            "checkout_subscription": ("checkout", "subscription", "cancellation", "past_due"),
            "refund_credit_webhook": ("refund", "credit", "quota reset", "webhook idempotency"),
        },
    },
    ("production_launch", "production_backup_rollback_incident"): {
        "subitems": {
            "backup_restore": PRODUCTION_BACKUP_RESTORE_EVIDENCE,
            "rollback_incident_smoke": PRODUCTION_ROLLBACK_INCIDENT_SMOKE_EVIDENCE,
        },
        "tokens": {
            "backup_restore": ("backup", "postgres restore", "object restore", "rpo", "rto"),
            "rollback_incident_smoke": ("rollback", "incident", "migration compatibility", "post-deploy smoke"),
        },
    },
    ("production_launch", "production_legal_support_policy"): {
        "subitems": {
            "legal_policy": PRODUCTION_LEGAL_POLICY_EVIDENCE,
            "support_billing_policy": PRODUCTION_SUPPORT_BILLING_POLICY_EVIDENCE,
        },
        "tokens": {
            "legal_policy": ("terms", "privacy", "acceptable use", "ai/content", "ip complaint"),
            "support_billing_policy": ("support", "billing", "cancellation", "refund"),
        },
    },
}

SPLIT_CHECKLIST_ITEM_EVIDENCE = {
    "Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。": {
        "gate": "private_beta_staging",
        "check_id": "staging_object_storage_signed_downloads",
        "path": STAGING_OBJECT_STORAGE_SIGNED_URL_EVIDENCE,
        "allowed_statuses": {"pass_with_blockers_preserved"},
        "allow_preserved_blockers": True,
        "tokens": ("signed", "download", "expiry", "direct object", "cross tenant"),
    },
    "Private Beta/Staging object retention/cleanup runtime evidence 通过：staging evidence proves retention policy, expired export cleanup, orphan cleanup, and audit refs under `ops/evidence/staging/`。": {
        "gate": "private_beta_staging",
        "check_id": "staging_object_storage_signed_downloads",
        "path": STAGING_OBJECT_STORAGE_RETENTION_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("retention", "expired export cleanup", "orphan cleanup", "audit"),
    },
    "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。": {
        "gate": "private_beta_staging",
        "check_id": "staging_legal_external_user_pages",
        "path": STAGING_LEGAL_EXTERNAL_PAGES_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("terms", "privacy", "acceptable use", "ai/content", "ip complaint"),
    },
    "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。": {
        "gate": "private_beta_staging",
        "check_id": "staging_legal_external_user_pages",
        "path": STAGING_LEGAL_EXTERNAL_PAGES_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("terms", "privacy", "acceptable use", "ai/content", "ip complaint"),
    },
    "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。": {
        "gate": "private_beta_staging",
        "check_id": "staging_legal_external_user_pages",
        "path": STAGING_SUPPORT_CONTACT_VISIBILITY_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("support", "report-problem", "external user"),
    },
    "Production provider mode deployment evidence 通过：production evidence proves either real provider contract/monitoring/cost/staging verification or explicit invite/comp-only mode under `ops/evidence/production/`。": {
        "gate": "production_launch",
        "check_id": "production_provider_or_comp_only_mode",
        "path": PRODUCTION_PROVIDER_MODE_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("production", "provider", "mode"),
    },
    "Production public paid/real-generation claims evidence 通过：production evidence proves paid and real-generation claims are enabled only with real provider evidence, or hidden for invite/comp-only mode under `ops/evidence/production/`。": {
        "gate": "production_launch",
        "check_id": "production_provider_or_comp_only_mode",
        "path": PRODUCTION_CLAIMS_ALIGNMENT_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("paid", "real-generation", "claims"),
    },
    "Production checkout/subscription/cancellation/past_due runtime evidence 通过 under `ops/evidence/production/`。": {
        "gate": "production_launch",
        "check_id": "production_paid_billing_lifecycle",
        "path": PRODUCTION_BILLING_LIFECYCLE_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("checkout", "subscription", "cancellation", "past_due"),
    },
    "Production refund/credit/quota reset/webhook idempotency runtime evidence 通过 under `ops/evidence/production/`。": {
        "gate": "production_launch",
        "check_id": "production_paid_billing_lifecycle",
        "path": PRODUCTION_BILLING_IDEMPOTENCY_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("refund", "credit", "quota reset", "webhook"),
    },
    "Production backup/restore runtime evidence 通过：production evidence proves backup schedule, Postgres restore, object restore, RPO/RTO, and audit refs under `ops/evidence/production/`。": {
        "gate": "production_launch",
        "check_id": "production_backup_rollback_incident",
        "path": PRODUCTION_BACKUP_RESTORE_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("backup", "postgres restore", "object restore", "rpo", "rto"),
    },
    "Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves rollback drill, incident/alert path, migration compatibility, and post-deploy smoke under `ops/evidence/production/`。": {
        "gate": "production_launch",
        "check_id": "production_backup_rollback_incident",
        "path": PRODUCTION_ROLLBACK_INCIDENT_SMOKE_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("rollback", "incident", "migration compatibility", "post-deploy smoke"),
    },
    "Production public legal policy deployment evidence 通过：production evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow visibility under `ops/evidence/production/`。": {
        "gate": "production_launch",
        "check_id": "production_legal_support_policy",
        "path": PRODUCTION_LEGAL_POLICY_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("terms", "privacy", "acceptable use", "ai/content", "ip complaint"),
    },
    "Production public support/billing policy deployment evidence 通过：production evidence proves support contact and paid billing/cancellation/refund policy visibility under `ops/evidence/production/`。": {
        "gate": "production_launch",
        "check_id": "production_legal_support_policy",
        "path": PRODUCTION_SUPPORT_BILLING_POLICY_EVIDENCE,
        "allowed_statuses": {"pass", "passed"},
        "allow_preserved_blockers": False,
        "tokens": ("support", "billing", "cancellation", "refund"),
    },
}

FORBIDDEN_RUNTIME_GATE_PATH_PREFIXES = {
    "private_beta_staging": (
        "ops/evidence/backup-restore/",
        "ops/evidence/observability/",
        "ops/evidence/local/",
        "ops/evidence/local_alpha/",
        "ops/evidence/production/",
    ),
    "production_launch": (
        "ops/evidence/backup-restore/",
        "ops/evidence/observability/",
        "ops/evidence/local/",
        "ops/evidence/local_alpha/",
        "ops/evidence/staging/",
    ),
}

CHECK_LEVEL_EVIDENCE_TO_CHECKLIST_ITEM = {
    ("private_beta_staging", "staging_auth_rbac_tenant_audit"): "Private Beta/Staging auth/RBAC/tenant/audit runtime evidence 通过。",
    ("private_beta_staging", "staging_brief_upload_confirmation"): "Private Beta/Staging brief/upload/confirmation runtime evidence 通过。",
    ("private_beta_staging", "staging_quota_rate_limit_spend_cap"): "Private Beta/Staging quota/rate-limit/spend-cap runtime evidence 通过。",
    ("private_beta_staging", "staging_support_retry_abuse_ops"): "Private Beta/Staging support/retry/abuse runtime evidence 通过。",
    ("private_beta_staging", "staging_eval_qa_safety_runtime"): "Private Beta/Staging eval/QA/safety enforcement runtime evidence 通过。",
    ("private_beta_staging", "staging_crawler_approval_provenance"): "Private Beta/Staging crawler approval/provenance runtime evidence 通过。",
    ("private_beta_staging", "staging_legal_external_user_pages"): "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。",
    ("production_launch", "production_skill_release_eval_canary"): "Production skill release/eval/canary runtime/deployment evidence 通过。",
    ("production_launch", "production_activation_review_audit"): "Production activation review/audit runtime/deployment evidence 通过。",
    ("production_launch", "production_abuse_throttle_hold"): "Production abuse throttle/hold runtime/deployment evidence 通过。",
    ("production_launch", "production_security_launch_checks"): "Production security launch-check runtime/deployment evidence 通过。",
}

PARTIAL_RUNTIME_ITEMS_THAT_DO_NOT_PASS_RELEASE_CHECKS = {
    STAGING_OBSERVABILITY_RUNTIME_CHECKLIST_ITEM,
}

CHECK_LEVEL_EVIDENCE_PRESERVED_BLOCKERS = {
    ("private_beta_staging", "staging_auth_rbac_tenant_audit"): {
        "staging_object_storage_signed_downloads",
    },
    ("private_beta_staging", "staging_brief_upload_confirmation"): {
        "staging_object_storage_signed_downloads",
    },
    ("private_beta_staging", "staging_quota_rate_limit_spend_cap"): {
        "staging_object_storage_signed_downloads",
    },
    ("private_beta_staging", "staging_support_retry_abuse_ops"): {
        "staging_object_storage_signed_downloads",
    },
    ("private_beta_staging", "staging_eval_qa_safety_runtime"): {
        "staging_object_storage_signed_downloads",
    },
    ("private_beta_staging", "staging_legal_external_user_pages"): {
        "staging_object_storage_signed_downloads",
    },
    ("production_launch", "production_skill_release_eval_canary"): {
        "production_provider_or_comp_only_mode",
        "production_paid_billing_lifecycle",
        "production_backup_rollback_incident",
        "production_legal_support_policy",
    },
    ("production_launch", "production_activation_review_audit"): {
        "production_provider_or_comp_only_mode",
        "production_paid_billing_lifecycle",
        "production_backup_rollback_incident",
        "production_legal_support_policy",
    },
    ("production_launch", "production_abuse_throttle_hold"): {
        "production_provider_or_comp_only_mode",
        "production_paid_billing_lifecycle",
        "production_backup_rollback_incident",
        "production_legal_support_policy",
    },
    ("production_launch", "production_security_launch_checks"): {
        "production_provider_or_comp_only_mode",
        "production_paid_billing_lifecycle",
        "production_backup_rollback_incident",
        "production_legal_support_policy",
    },
}

ACTIVE_CONDITION_EVIDENCE_REQUIREMENTS = {
    ("local_alpha", "local_alpha_runtime_not_validated"): {
        "path_patterns": (r"docker-compose\.yml", r"\.env\.example", r"ops/evidence/(?:local_alpha|local)/"),
        "tokens": ("local", "runtime"),
    },
    ("ci", "ci_workflow_not_installed"): {
        "path_patterns": (r"ops/ci/", r"\.github/workflows/"),
        "tokens": ("workflow",),
    },
    ("ci", "ci_gate_not_executed_on_main"): {
        "path_patterns": (r"fixtures/ops/", r"ops/evidence/ci/"),
        "tokens": ("ci", "blocked"),
    },
    ("ci", "ci_playwright_smoke_missing"): {
        "path_patterns": (r"ops/ci/", r"scripts/playwright_smoke\.sh", r"ops/evidence/ci/"),
        "tokens": ("playwright",),
    },
    ("ci", "ci_docker_image_build_missing"): {
        "path_patterns": (r"ops/ci/", r"scripts/docker_build_smoke\.sh", r"ops/evidence/ci/"),
        "tokens": ("docker",),
    },
    ("private_beta_staging", "tenant_isolation_not_enforced"): {
        "path_patterns": (r"ops/evidence/staging/", r"backend/", r"openapi/"),
        "tokens": ("staging", "tenant"),
    },
    ("private_beta_staging", "staging_brief_upload_confirmation_runtime_missing"): {
        "path_patterns": (r"ops/evidence/staging/", r"fixtures/stage0/rev2/workflows/", r"web/"),
        "tokens": ("staging", "brief", "upload", "confirmation"),
    },
    ("private_beta_staging", "rate_limit_spend_cap_runtime_missing"): {
        "path_patterns": (r"ops/evidence/staging/", r"backend/", r"fixtures/stage0/rev2/"),
        "tokens": ("staging", "rate", "spend"),
    },
    ("private_beta_staging", "object_storage_signed_retention_runtime_missing"): {
        "path_patterns": (r"ops/evidence/staging/", r"backend/", r"docker-compose\.yml"),
        "tokens": ("staging", "signed", "retention"),
    },
    ("private_beta_staging", "support_abuse_runtime_missing"): {
        "path_patterns": (r"ops/evidence/staging/", r"admin/", r"fixtures/stage0/rev2/abuse/"),
        "tokens": ("staging", "support", "abuse"),
    },
    ("private_beta_staging", "eval_qa_safety_runtime_missing"): {
        "path_patterns": (r"ops/evidence/staging/", r"fixtures/stage0/rev2/eval/", r"scripts/"),
        "tokens": ("staging", "safety"),
    },
    ("private_beta_staging", "crawler_governance_runtime_missing"): {
        "path_patterns": (r"ops/evidence/staging/", r"fixtures/stage0/rev2/crawler/", r"backend/"),
        "tokens": ("staging", "crawler"),
    },
    ("private_beta_staging", "crawler_material_retention_takedown_runtime_missing"): {
        "path_patterns": (r"ops/evidence/staging/", r"fixtures/stage0/rev2/crawler/", r"backend/"),
        "tokens": ("staging", "crawler", "retention"),
    },
    ("private_beta_staging", "staging_observability_restore_load_missing"): {
        "path_patterns": (r"ops/evidence/staging/", r"ops/evidence/backup-restore/", r"ops/evidence/observability/"),
        "tokens": ("staging",),
    },
    ("private_beta_staging", "external_user_legal_pages_missing"): {
        "path_patterns": (r"ops/evidence/staging/", r"web/", r"ops/"),
        "tokens": ("staging", "external"),
    },
    ("production_launch", "dev_mock_provider_public_claims_unresolved"): {
        "path_patterns": (r"ops/evidence/production/", r"fixtures/stage0/rev2/release_gate_evidence\.production_launch\.json"),
        "tokens": ("production", "provider"),
    },
    ("production_launch", "real_provider_or_comp_only_mode_missing"): {
        "path_patterns": (r"ops/evidence/production/", r"fixtures/stage0/rev2/release_gate_evidence\.production_launch\.json"),
        "tokens": ("production", "provider"),
    },
    ("production_launch", "paid_billing_or_comp_only_mode_missing"): {
        "path_patterns": (r"ops/evidence/production/", r"backend/", r"web/"),
        "tokens": ("production", "billing"),
    },
    ("production_launch", "skill_release_eval_canary_missing"): {
        "path_patterns": (r"ops/evidence/production/", r"admin/", r"fixtures/stage0/rev2/eval/"),
        "tokens": ("production", "skill"),
    },
    ("production_launch", "activation_eval_review_audit_runtime_missing"): {
        "path_patterns": (r"ops/evidence/production/", r"fixtures/stage0/rev2/eval/", r"admin/"),
        "tokens": ("production", "activation"),
    },
    ("production_launch", "admin_high_risk_review_runtime_missing"): {
        "path_patterns": (r"ops/evidence/production/", r"admin/", r"backend/"),
        "tokens": ("production", "review"),
    },
    ("production_launch", "abuse_throttle_hold_missing"): {
        "path_patterns": (r"ops/evidence/production/", r"admin/", r"fixtures/stage0/rev2/abuse/"),
        "tokens": ("production", "abuse"),
    },
    ("production_launch", "security_privacy_legal_incomplete"): {
        "path_patterns": (r"ops/evidence/production/", r"scripts/security_scan_smoke\.sh", r"web/"),
        "tokens": ("production", "security"),
    },
    ("production_launch", "secret_exposure_runtime_not_verified"): {
        "path_patterns": (r"ops/evidence/production/", r"scripts/security_scan_smoke\.sh", r"backend/"),
        "tokens": ("production", "secret"),
    },
    ("production_launch", "backup_restore_rollback_smoke_missing"): {
        "path_patterns": (r"ops/evidence/production/", r"ops/evidence/backup-restore/", r"ops/release/"),
        "tokens": ("production", "backup"),
    },
    ("production_launch", "production_deploy_rollback_smoke_missing"): {
        "path_patterns": (r"ops/evidence/production/", r"ops/release/", r"scripts/staging_smoke\.sh"),
        "tokens": ("production", "deploy"),
    },
    ("production_launch", "public_legal_support_policy_not_deployed"): {
        "path_patterns": (r"ops/evidence/production/", r"web/", r"ops/"),
        "tokens": ("production", "policy"),
    },
    ("production_launch", "ci_staging_gates_not_passed"): {
        "path_patterns": (r"fixtures/stage0/rev2/release_gate_evidence\.ci\.json", r"fixtures/stage0/rev2/release_gate_evidence\.private_beta_staging\.json"),
        "tokens": ("ci", "staging"),
    },
}

PRIVATE_BETA_STAGING_RUNTIME_OPEN_CHECK_ITEMS = {
    "Private Beta/Staging auth/RBAC/tenant/audit runtime evidence 通过。": {
        "staging_auth_rbac_tenant_audit",
    },
    "Private Beta/Staging brief/upload/confirmation runtime evidence 通过。": {
        "staging_brief_upload_confirmation",
    },
    "Private Beta/Staging object storage signed download/retention runtime evidence 通过。": {
        "staging_object_storage_signed_downloads",
    },
    "Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。": {
        "staging_object_storage_signed_url_subitem",
    },
    "Private Beta/Staging object retention/cleanup runtime evidence 通过：staging evidence proves retention policy, expired export cleanup, orphan cleanup, and audit refs under `ops/evidence/staging/`。": {
        "staging_object_storage_signed_downloads",
    },
    "Private Beta/Staging quota/rate-limit/spend-cap runtime evidence 通过。": {
        "staging_quota_rate_limit_spend_cap",
    },
    "Private Beta/Staging support/retry/abuse runtime evidence 通过。": {
        "staging_support_retry_abuse_ops",
    },
    "Private Beta/Staging eval/QA/safety enforcement runtime evidence 通过。": {
        "staging_eval_qa_safety_runtime",
    },
    "Private Beta/Staging crawler approval/provenance runtime evidence 通过。": {
        "staging_crawler_approval_provenance",
    },
    "Private Beta/Staging observability/backup/load runtime evidence 通过。": {
        "staging_observability_backup_load",
    },
    STAGING_OBSERVABILITY_RUNTIME_CHECKLIST_ITEM: {
        "staging_observability_backup_load",
    },
    "Private Beta/Staging backup/restore runtime evidence 通过：staging evidence proves Postgres restore and object restore entries required by `staging_observability_backup_load` preflight。": {
        "staging_observability_backup_load",
    },
    "Private Beta/Staging load runtime evidence 通过：staging evidence proves chat/task、worker generation、ZIP export、signed download、crawler throttle、quota contention、workspace rendering load entries required by `staging_observability_backup_load` preflight。": {
        "staging_observability_backup_load",
    },
    "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。": {
        "staging_legal_external_user_pages",
    },
    "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。": {
        "staging_legal_external_user_pages",
    },
    "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。": {
        "staging_legal_external_user_pages",
    },
}

PRODUCTION_RUNTIME_OPEN_CHECK_ITEMS = {
    "Production provider-or-comp-only runtime/deployment evidence 通过。": {
        "production_provider_or_comp_only_mode",
    },
    "Production provider mode deployment evidence 通过：production evidence proves either real provider contract/monitoring/cost/staging verification or explicit invite/comp-only mode under `ops/evidence/production/`。": {
        "production_provider_or_comp_only_mode",
    },
    "Production public paid/real-generation claims evidence 通过：production evidence proves paid and real-generation claims are enabled only with real provider evidence, or hidden for invite/comp-only mode under `ops/evidence/production/`。": {
        "production_provider_or_comp_only_mode",
    },
    "Production paid billing lifecycle runtime/deployment evidence 通过。": {
        "production_paid_billing_lifecycle",
    },
    "Production checkout/subscription/cancellation/past_due runtime evidence 通过 under `ops/evidence/production/`。": {
        "production_paid_billing_lifecycle",
    },
    "Production refund/credit/quota reset/webhook idempotency runtime evidence 通过 under `ops/evidence/production/`。": {
        "production_paid_billing_lifecycle",
    },
    "Production skill release/eval/canary runtime/deployment evidence 通过。": {
        "production_skill_release_eval_canary",
    },
    "Production activation review/audit runtime/deployment evidence 通过。": {
        "production_activation_review_audit",
    },
    "Production abuse throttle/hold runtime/deployment evidence 通过。": {
        "production_abuse_throttle_hold",
    },
    "Production security launch-check runtime/deployment evidence 通过。": {
        "production_security_launch_checks",
    },
    PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_CHECKLIST_ITEM: {
        "production_backup_rollback_incident",
    },
    "Production backup/rollback/incident/post-deploy smoke runtime/deployment evidence 通过。": {
        "production_backup_rollback_incident",
    },
    "Production backup/restore runtime evidence 通过：production evidence proves backup schedule, Postgres restore, object restore, RPO/RTO, and audit refs under `ops/evidence/production/`。": {
        "production_backup_rollback_incident",
    },
    "Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves rollback drill, incident/alert path, migration compatibility, and post-deploy smoke under `ops/evidence/production/`。": {
        "production_backup_rollback_incident",
    },
    PRODUCTION_POST_DEPLOY_LAUNCH_CLEARING_CHECKLIST_ITEM: {
        "production_backup_rollback_incident",
    },
    "Production legal/support policy deployment evidence 通过。": {
        "production_legal_support_policy",
    },
    "Production public legal policy deployment evidence 通过：production evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow visibility under `ops/evidence/production/`。": {
        "production_legal_support_policy",
    },
    "Production public support/billing policy deployment evidence 通过：production evidence proves support contact and paid billing/cancellation/refund policy visibility under `ops/evidence/production/`。": {
        "production_legal_support_policy",
    },
}

RELEASE_GATE_CHECK_LEVEL_RUNTIME_OPEN_ITEMS = {
    **CI_RUNTIME_OPEN_CHECK_ITEMS,
    **PRIVATE_BETA_STAGING_RUNTIME_OPEN_CHECK_ITEMS,
    **PRODUCTION_RUNTIME_OPEN_CHECK_ITEMS,
}

LOCAL_ALPHA_AGGREGATE_RUNTIME_ITEM = (
    "Local Alpha workflow API/Playwright end-to-end smoke evidence 通过并写入 release gate fixture。"
)
CI_AGGREGATE_RUNTIME_ITEM = (
    "CI installed workflow runtime evidence 通过：PR/main run、Playwright smoke、Docker image build 均有 validator-resolvable evidence。"
)
PRIVATE_BETA_STAGING_AGGREGATE_RUNTIME_ITEM = (
    "Private Beta/Staging external-user runtime evidence 通过：auth/RBAC/tenant、storage、quota/rate limit、support/abuse、safety/QA/crawler、observability/backup/load、legal visibility 均有 staging evidence。"
)
PRODUCTION_AGGREGATE_RUNTIME_ITEM = (
    "Production Launch runtime/deployment evidence 通过：provider-or-comp-only、paid lifecycle、skill canary、activation audit、abuse hold、security、backup/rollback/post-deploy smoke、legal/support policy 均有 production evidence。"
)

LOCAL_ALPHA_WORKFLOW_RUNTIME_ITEMS = {
    "电商增长包 API smoke test 通过。",
    "电商增长包 Playwright happy path 通过。",
    "电商增长包 export ZIP evidence 通过：`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    "商业视觉文档包 API smoke test 通过。",
    "商业视觉文档包 Playwright happy path 通过。",
    "商业视觉文档包 export ZIP evidence 通过：`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    "本地商家活动包 API smoke test 通过。",
    "本地商家活动包 Playwright happy path 通过。",
    "本地商家活动包 export ZIP evidence 通过：`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    "角色/IP 概念包 API smoke test 通过。",
    "角色/IP 概念包 Playwright happy path 通过。",
    "角色/IP 概念包 export ZIP evidence 通过：`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
}

LOCAL_ALPHA_RELEASE_GATE_WORKFLOW_RUNTIME_OPEN_CHECK_ITEMS = {
    "Local Alpha 电商增长包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/ecommerce_growth_pack.api_smoke.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` 均证明 running local stack。": {
        "local_alpha_e2e_workflow_smoke",
    },
    "Local Alpha 商业视觉文档包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/business_visual_doc_pack.api_smoke.json`、`ops/evidence/local_alpha/business_visual_doc_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` 均证明 running local stack。": {
        "local_alpha_e2e_workflow_smoke",
    },
    "Local Alpha 本地商家活动包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/local_merchant_campaign_pack.api_smoke.json`、`ops/evidence/local_alpha/local_merchant_campaign_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` 均证明 running local stack。": {
        "local_alpha_e2e_workflow_smoke",
    },
    "Local Alpha 角色/IP 概念包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/character_ip_concept_pack.api_smoke.json`、`ops/evidence/local_alpha/character_ip_concept_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` 均证明 running local stack。": {
        "local_alpha_e2e_workflow_smoke",
    },
}

LOCAL_ALPHA_RELEASE_GATE_WORKFLOW_RUNTIME_CLOSED_ITEMS = {
    "Local Alpha 电商增长包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/ecommerce_growth_pack.api_smoke.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` 均证明 running local stack。": "ecommerce_growth_pack",
    "Local Alpha 商业视觉文档包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/business_visual_doc_pack.api_smoke.json`、`ops/evidence/local_alpha/business_visual_doc_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` 均证明 running local stack。": "business_visual_doc_pack",
}

LOCAL_ALPHA_WORKFLOW_RUNTIME_EVIDENCE_FILES = {
    "ecommerce_growth_pack": {
        "api": ROOT / "ops" / "evidence" / "local_alpha" / "ecommerce_growth_pack.api_smoke.json",
        "playwright": ROOT
        / "ops"
        / "evidence"
        / "local_alpha"
        / "ecommerce_growth_pack.playwright_happy_path.json",
        "export": ROOT / "ops" / "evidence" / "local_alpha" / "ecommerce_growth_pack.export_zip.json",
    },
    "business_visual_doc_pack": {
        "api": ROOT / "ops" / "evidence" / "local_alpha" / "business_visual_doc_pack.api_smoke.json",
        "playwright": ROOT
        / "ops"
        / "evidence"
        / "local_alpha"
        / "business_visual_doc_pack.playwright_happy_path.json",
        "export": ROOT / "ops" / "evidence" / "local_alpha" / "business_visual_doc_pack.export_zip.json",
    },
    "local_merchant_campaign_pack": {
        "api": ROOT / "ops" / "evidence" / "local_alpha" / "local_merchant_campaign_pack.api_smoke.json",
        "playwright": ROOT
        / "ops"
        / "evidence"
        / "local_alpha"
        / "local_merchant_campaign_pack.playwright_happy_path.json",
        "export": ROOT
        / "ops"
        / "evidence"
        / "local_alpha"
        / "local_merchant_campaign_pack.export_zip.json",
    },
    "character_ip_concept_pack": {
        "api": ROOT / "ops" / "evidence" / "local_alpha" / "character_ip_concept_pack.api_smoke.json",
        "playwright": ROOT
        / "ops"
        / "evidence"
        / "local_alpha"
        / "character_ip_concept_pack.playwright_happy_path.json",
        "export": ROOT / "ops" / "evidence" / "local_alpha" / "character_ip_concept_pack.export_zip.json",
    },
}

RELEASE_GATE_AGGREGATE_REQUIREMENTS = {
    "local_alpha": {
        LOCAL_ALPHA_AGGREGATE_RUNTIME_ITEM: (
            LOCAL_ALPHA_WORKFLOW_RUNTIME_ITEMS
            | set(LOCAL_ALPHA_RELEASE_GATE_WORKFLOW_RUNTIME_OPEN_CHECK_ITEMS)
        ),
    },
    "ci": {
        CI_AGGREGATE_RUNTIME_ITEM: set(CI_RUNTIME_OPEN_CHECK_ITEMS),
    },
    "private_beta_staging": {
        PRIVATE_BETA_STAGING_AGGREGATE_RUNTIME_ITEM: set(PRIVATE_BETA_STAGING_RUNTIME_OPEN_CHECK_ITEMS),
    },
    "production_launch": {
        PRODUCTION_AGGREGATE_RUNTIME_ITEM: set(PRODUCTION_RUNTIME_OPEN_CHECK_ITEMS),
    },
}

RELEASE_GATE_AGGREGATE_ITEMS = {
    gate: next(iter(requirements))
    for gate, requirements in RELEASE_GATE_AGGREGATE_REQUIREMENTS.items()
}

RELEASE_GATE_AGGREGATE_GUARD_CHECKS = {
    gate: set().union(*requirements.values())
    for gate, requirements in RELEASE_GATE_AGGREGATE_REQUIREMENTS.items()
}

RELEASE_GATE_AGGREGATE_GUARD_ITEMS = {
    "local_alpha": set(LOCAL_ALPHA_WORKFLOW_RUNTIME_ITEMS)
    | set(LOCAL_ALPHA_RELEASE_GATE_WORKFLOW_RUNTIME_OPEN_CHECK_ITEMS),
    "ci": set(CI_RUNTIME_OPEN_CHECK_ITEMS),
    "private_beta_staging": set(PRIVATE_BETA_STAGING_RUNTIME_OPEN_CHECK_ITEMS),
    "production_launch": set(PRODUCTION_RUNTIME_OPEN_CHECK_ITEMS),
}

RELEASE_GATE_CHECK_BLOCKING_CONDITIONS = {
    "local_alpha": {
        "workflow_fixture_coverage": {"generic_workflow_only"},
        "eval_fixture_coverage": {"safety_red_team_fixture_failure"},
        "crawler_governance_fixture_coverage": {"crawler_unapproved_source_fixture_gap"},
        "schema_fixture_validation": {"schema_fixture_drift", "external_agent_contract_trace_gap"},
        "local_alpha_service_presence": {"missing_web_admin_backend_presence"},
        "local_alpha_runtime_stack": {"local_alpha_runtime_not_validated"},
        "local_alpha_e2e_workflow_smoke": {"generic_workflow_only", "missing_export_provenance_fixture"},
    },
    "ci": {
        "ci_installed_workflow": {"ci_workflow_not_installed"},
        "ci_gate_runtime_execution": {"ci_gate_not_executed_on_main"},
        "ci_playwright_smoke": {"ci_playwright_smoke_missing"},
        "ci_docker_image_build": {"ci_docker_image_build_missing"},
    },
    "private_beta_staging": {
        "staging_auth_rbac_tenant_audit": {"tenant_isolation_not_enforced"},
        "staging_brief_upload_confirmation": {"staging_brief_upload_confirmation_runtime_missing"},
        "staging_object_storage_signed_downloads": {"object_storage_signed_retention_runtime_missing"},
        "staging_quota_rate_limit_spend_cap": {"rate_limit_spend_cap_runtime_missing"},
        "staging_support_retry_abuse_ops": {"support_abuse_runtime_missing"},
        "staging_eval_qa_safety_runtime": {"eval_qa_safety_runtime_missing"},
        "staging_crawler_approval_provenance": {
            "crawler_governance_runtime_missing",
            "crawler_material_retention_takedown_runtime_missing",
        },
        "staging_observability_backup_load": {"staging_observability_restore_load_missing"},
        "staging_legal_external_user_pages": {"external_user_legal_pages_missing"},
    },
    "production_launch": {
        "production_provider_or_comp_only_mode": {
            "dev_mock_provider_public_claims_unresolved",
            "real_provider_or_comp_only_mode_missing",
        },
        "production_paid_billing_lifecycle": {"paid_billing_or_comp_only_mode_missing"},
        "production_skill_release_eval_canary": {"skill_release_eval_canary_missing"},
        "production_activation_review_audit": {
            "activation_eval_review_audit_runtime_missing",
            "admin_high_risk_review_runtime_missing",
        },
        "production_abuse_throttle_hold": {"abuse_throttle_hold_missing"},
        "production_security_launch_checks": {
            "security_privacy_legal_incomplete",
            "secret_exposure_runtime_not_verified",
        },
        "production_backup_rollback_incident": {
            "backup_restore_rollback_smoke_missing",
            "production_deploy_rollback_smoke_missing",
            "ci_staging_gates_not_passed",
        },
        "production_legal_support_policy": {"public_legal_support_policy_not_deployed"},
    },
}

DO_NOT_LAUNCH_CONDITION_COVERAGE = {
    "local_alpha": {
        "generic_workflow_only": "Vertical workflows 只通过 generic rendering tests，没有 domain fixtures、four-option taxonomy、required outputs、QA/safety checks、manifest validation。",
        "candidate_asset_provenance_missing": "Candidate assets 缺 provider/model/prompt/spec/skill/safety provenance。",
        "external_agent_contract_trace_gap": "External APIs 或 internal agent steps 缺合同和 trace completeness。",
        "missing_export_provenance_fixture": "Candidate assets 缺 provider/model/prompt/spec/skill/safety provenance。",
        "schema_fixture_drift": "External APIs 或 internal agent steps 缺合同和 trace completeness。",
        "crawler_unapproved_source_fixture_gap": "Crawler 可抓取或导入 unapproved source。",
        "safety_red_team_fixture_failure": "Safety red-team fixtures 失败。",
        "blocking_qa_export_without_audited_override": "Export package 可带 blocking QA failure 出口且没有 eligible audited override。",
        "feedback_governance_fixture_gap": "Feedback 可影响 prompt/skill evolution，但缺 provenance、filtering、weighting、regression fixtures。",
        "quota_transaction_tests_missing": "Quota reservation/commit/refund 未经过 retry/concurrency transaction tests。",
        "missing_web_admin_backend_presence": "External APIs 或 internal agent steps 缺合同和 trace completeness。",
        "local_alpha_runtime_not_validated": "Production deploy 缺 rollback plan、migration compatibility notes、post-deploy smoke test。",
    },
    "ci": {
        "ci_workflow_not_installed": "Production deploy 缺 rollback plan、migration compatibility notes、post-deploy smoke test。",
        "ci_gate_not_executed_on_main": "Production deploy 缺 rollback plan、migration compatibility notes、post-deploy smoke test。",
        "ci_playwright_smoke_missing": "Vertical workflows 只通过 generic rendering tests，没有 domain fixtures、four-option taxonomy、required outputs、QA/safety checks、manifest validation。",
        "ci_docker_image_build_missing": "Production deploy 缺 rollback plan、migration compatibility notes、post-deploy smoke test。",
    },
    "private_beta_staging": {
        "tenant_isolation_not_enforced": "User projects、assets、exports、traces、quota、support tickets、audit logs 任何 tenant-isolation test 失败。",
        "staging_brief_upload_confirmation_runtime_missing": "Vertical workflows 只通过 generic rendering tests，没有 domain fixtures、four-option taxonomy、required outputs、QA/safety checks、manifest validation。",
        "rate_limit_spend_cap_runtime_missing": "Rate limits、provider concurrency limits、spend cap 或 emergency kill switch 缺失。",
        "object_storage_signed_retention_runtime_missing": "Object storage 缺 tenant-scoped signed access、retention policy、cleanup 或 cross-tenant denial tests。",
        "support_abuse_runtime_missing": "Admin review decisions 可变更、缺 reviewer rationale，或 high-risk changes 绕过 RBAC/audit/second review。",
        "eval_qa_safety_runtime_missing": "Safety 只是 disclaimer，没有在 brief/provider request/provider response/QA/export 强制执行。",
        "crawler_governance_runtime_missing": "Crawler 可抓取或导入 unapproved source。",
        "crawler_material_retention_takedown_runtime_missing": "Crawler-derived active materials 缺 provenance、raw-retention limits 或 takedown path。",
        "staging_observability_restore_load_missing": "Staging 缺 provider、queue、export、quota、safety、crawler、object storage、billing、admin failure 的 logs/metrics/traces/dashboards/alerts/runbooks。",
        "external_user_legal_pages_missing": "Public launch 缺 Terms、Privacy、Acceptable Use、support contact、AI/content responsibility disclaimer 或 IP complaint flow。",
    },
    "production_launch": {
        "dev_mock_provider_public_claims_unresolved": "Dev/mock provider 被 UI、docs、marketing 或 billing 暗示为真实生产生成。",
        "real_provider_or_comp_only_mode_missing": "Dev/mock provider 被 UI、docs、marketing 或 billing 暗示为真实生产生成。",
        "paid_billing_or_comp_only_mode_missing": "Paid launch 缺 checkout/subscription/cancellation/past_due/quota reset 流程测试，且没有明确 invite/comp-only 模式并隐藏付费声明。",
        "skill_release_eval_canary_missing": "Active skills 缺 owner、risk level、eval suite、safety refs、release notes、canary metrics 或 rollback target。",
        "activation_eval_review_audit_runtime_missing": "Prompt、skill、provider routing、safety rule、crawler-derived changes 可绕过 eval/review/audit activation。",
        "admin_high_risk_review_runtime_missing": "Admin review decisions 可变更、缺 reviewer rationale，或 high-risk changes 绕过 RBAC/audit/second review。",
        "abuse_throttle_hold_missing": "Rate limits、provider concurrency limits、spend cap 或 emergency kill switch 缺失。",
        "security_privacy_legal_incomplete": "Secrets 或 provider keys 可进入 frontend bundle、logs、traces、exports、crawler findings、screenshots、support tickets 或 admin UI。",
        "secret_exposure_runtime_not_verified": "Secrets 或 provider keys 可进入 frontend bundle、logs、traces、exports、crawler findings、screenshots、support tickets 或 admin UI。",
        "backup_restore_rollback_smoke_missing": "Backups 和 restore drills 未完成。",
        "production_deploy_rollback_smoke_missing": "Production deploy 缺 rollback plan、migration compatibility notes、post-deploy smoke test。",
        "public_legal_support_policy_not_deployed": "Public launch 缺 Terms、Privacy、Acceptable Use、support contact、AI/content responsibility disclaimer 或 IP complaint flow。",
        "ci_staging_gates_not_passed": "Production deploy 缺 rollback plan、migration compatibility notes、post-deploy smoke test。",
    },
}

CONCRETE_EVIDENCE_PATH_PREFIXES = (
    ".env.example",
    ".github",
    "admin",
    "backend",
    "docker-compose.yml",
    "fixtures",
    "openapi",
    "ops",
    "schemas",
    "scripts",
    "web",
)

CONCRETE_EVIDENCE_PATH_RE = re.compile(
    r"(?<![A-Za-z0-9_./-])"
    r"("
    r"\.env\.example|"
    r"\.github(?:/[A-Za-z0-9._{}*,-]+)*|"
    r"admin(?:/[A-Za-z0-9._{}*,-]+)*|"
    r"backend(?:/[A-Za-z0-9._{}*,-]+)*|"
    r"docker-compose\.yml|"
    r"fixtures(?:/[A-Za-z0-9._{}*,-]+)*|"
    r"openapi(?:/[A-Za-z0-9._{}*,-]+)*|"
    r"ops(?:/[A-Za-z0-9._{}*,-]+)*|"
    r"schemas(?:/[A-Za-z0-9._{}*,-]+)*|"
    r"scripts(?:/[A-Za-z0-9._{}*,-]+)*|"
    r"web(?:/[A-Za-z0-9._{}*,-]+)*"
    r")"
)

RELEASE_GATE_PASS_BLOCKED_BY_OPEN_ITEMS = {
    "local_alpha": {
        "电商增长包 API smoke test 通过。",
        "电商增长包 Playwright happy path 通过。",
        "电商增长包 export ZIP evidence 通过：`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
        "商业视觉文档包 API smoke test 通过。",
        "商业视觉文档包 Playwright happy path 通过。",
        "商业视觉文档包 export ZIP evidence 通过：`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
        "本地商家活动包 API smoke test 通过。",
        "本地商家活动包 Playwright happy path 通过。",
        "本地商家活动包 export ZIP evidence 通过：`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
        "角色/IP 概念包 API smoke test 通过。",
        "角色/IP 概念包 Playwright happy path 通过。",
        "角色/IP 概念包 export ZIP evidence 通过：`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    },
    "ci": {
        "添加 PR/main CI 到 `.github/workflows`。（token-blocked：当前 token 缺 workflow scope；draft/evidence 已落在 `ops/ci/` 和 `fixtures/ops/`。）",
        "CI 在已安装 PR/main workflow 中运行 Playwright smoke。",
        "CI 在已安装 PR/main workflow 中 build Docker images。",
    },
    "private_beta_staging": {
        "执行 staging deploy。",
        "执行 staging smoke tests。",
        "staging request id propagation runtime evidence 通过。",
        "staging structured JSON logs runtime evidence 通过。",
        "staging OpenTelemetry traces runtime evidence 通过。",
        "staging backend/worker/crawler metrics runtime evidence 通过。",
        "导入并验证 staging dashboards runtime evidence。",
        "配置并验证 staging alert routes/runtime evidence。",
        "Staging post-deploy smoke tests 通过。",
    },
    "production_launch": {
        "CI Gate 全部通过。",
        "Private Beta/Staging Gate 全部通过。",
        PRODUCTION_POST_DEPLOY_LAUNCH_CLEARING_CHECKLIST_ITEM,
    },
}

RELEASE_GATE_OPEN_ITEM_GUARD_CHECKS = {
    "local_alpha": {
        "电商增长包 API smoke test 通过。": {"local_alpha_e2e_workflow_smoke"},
        "电商增长包 Playwright happy path 通过。": {"local_alpha_e2e_workflow_smoke"},
        "电商增长包 export ZIP evidence 通过：`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。": {
            "local_alpha_e2e_workflow_smoke"
        },
        "商业视觉文档包 API smoke test 通过。": {"local_alpha_e2e_workflow_smoke"},
        "商业视觉文档包 Playwright happy path 通过。": {"local_alpha_e2e_workflow_smoke"},
        "商业视觉文档包 export ZIP evidence 通过：`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。": {
            "local_alpha_e2e_workflow_smoke"
        },
        "本地商家活动包 API smoke test 通过。": {"local_alpha_e2e_workflow_smoke"},
        "本地商家活动包 Playwright happy path 通过。": {"local_alpha_e2e_workflow_smoke"},
        "本地商家活动包 export ZIP evidence 通过：`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。": {
            "local_alpha_e2e_workflow_smoke"
        },
        "角色/IP 概念包 API smoke test 通过。": {"local_alpha_e2e_workflow_smoke"},
        "角色/IP 概念包 Playwright happy path 通过。": {"local_alpha_e2e_workflow_smoke"},
        "角色/IP 概念包 export ZIP evidence 通过：`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。": {
            "local_alpha_e2e_workflow_smoke"
        },
    },
    "ci": {
        "添加 PR/main CI 到 `.github/workflows`。（token-blocked：当前 token 缺 workflow scope；draft/evidence 已落在 `ops/ci/` 和 `fixtures/ops/`。）": {
            "ci_installed_workflow",
            "ci_gate_runtime_execution",
        },
        "CI 在已安装 PR/main workflow 中运行 Playwright smoke。": {
            "ci_gate_runtime_execution",
            "ci_playwright_smoke",
        },
        "CI 在已安装 PR/main workflow 中 build Docker images。": {
            "ci_gate_runtime_execution",
            "ci_docker_image_build",
        },
    },
    "private_beta_staging": {
        "在 brief/provider request/provider response/QA/export 运行 safety policy。": {
            "staging_eval_qa_safety_runtime",
        },
        "staging crawler fetch/import governance runtime evidence 通过：source approval、robots、SSRF、rate limits、retention、exact-text warning、provenance links、source blocklist 均有 staging evidence。": {
            "staging_crawler_approval_provenance",
        },
        "temporary hold/throttle hooks runtime enforcement 通过。": {
            "staging_support_retry_abuse_ops",
        },
        "admin abuse queue runtime enforcement 通过。": {
            "staging_support_retry_abuse_ops",
        },
        "执行 staging deploy。": {"staging_observability_backup_load"},
        "执行 staging smoke tests。": {"staging_observability_backup_load"},
        "staging request id propagation runtime evidence 通过。": {
            "staging_observability_backup_load",
        },
        "staging structured JSON logs runtime evidence 通过。": {
            "staging_observability_backup_load",
        },
        "staging OpenTelemetry traces runtime evidence 通过。": {
            "staging_observability_backup_load",
        },
        "staging backend/worker/crawler metrics runtime evidence 通过。": {
            "staging_observability_backup_load",
        },
        "导入并验证 staging dashboards runtime evidence。": {
            "staging_observability_backup_load",
        },
        "配置并验证 staging alert routes/runtime evidence。": {
            "staging_observability_backup_load",
        },
        "Staging post-deploy smoke tests 通过。": {"staging_observability_backup_load"},
    },
    "production_launch": {
        "CI Gate 全部通过。": {
            "production_backup_rollback_incident",
        },
        "Private Beta/Staging Gate 全部通过。": {
            "production_backup_rollback_incident",
            "production_legal_support_policy",
        },
        PRODUCTION_POST_DEPLOY_LAUNCH_CLEARING_CHECKLIST_ITEM: {
            "production_backup_rollback_incident",
        },
    },
}

SCHEMA_FIXTURE_TARGETS = [
    ("activation_gate_contract.schema.json", FIXTURE_DIR / "eval" / "activation_gate_contract.json", "object"),
    ("analytics_taxonomy.schema.json", FIXTURE_DIR / "analytics" / "event_taxonomy.json", "object"),
    ("eval_storage_contract.schema.json", FIXTURE_DIR / "eval" / "eval_storage_contract.json", "object"),
    ("workflow_api_smoke_evidence.schema.json", FIXTURE_DIR / "eval" / "workflow_api_smoke_evidence.json", "object"),
    (
        "workflow_runtime_evidence_contract.schema.json",
        FIXTURE_DIR / "eval" / "workflow_runtime_evidence_contract.json",
        "object",
    ),
    ("eval_suite.schema.json", FIXTURE_DIR / "eval" / "starter_eval_suite.json", "object"),
    ("eval_result.schema.json", FIXTURE_DIR / "eval" / "starter_eval_results.json", "array_items"),
    ("trace_completeness.schema.json", FIXTURE_DIR / "eval" / "trace_completeness.json", "object"),
    ("trace_export_gate_matrix.schema.json", FIXTURE_DIR / "eval" / "trace_export_gate_matrix.json", "object"),
    ("safety_enforcement_contract.schema.json", FIXTURE_DIR / "eval" / "safety_enforcement_contract.json", "object"),
    ("qa_result.schema.json", FIXTURE_DIR / "eval" / "qa_results.json", "array_items"),
    ("qa_result_coverage.schema.json", FIXTURE_DIR / "eval" / "qa_result_coverage.json", "object"),
    ("qa_enforcement_matrix.schema.json", FIXTURE_DIR / "eval" / "qa_enforcement_matrix.json", "object"),
    ("export_override_contract.schema.json", FIXTURE_DIR / "eval" / "export_override_contract.json", "object"),
    ("safety_rule.schema.json", FIXTURE_DIR / "eval" / "safety_rules.json", "array_items"),
    ("workflow_acceptance.schema.json", FIXTURE_DIR / "workflows", "directory_objects"),
    ("crawler_governance.schema.json", FIXTURE_DIR / "crawler" / "crawler_governance_cases.json", "array_items"),
    ("feedback_event.schema.json", FIXTURE_DIR / "feedback" / "feedback_events.json", "array_items"),
    ("abuse_event.schema.json", FIXTURE_DIR / "abuse" / "abuse_events.json", "array_items"),
    ("release_gate_evidence.schema.json", FIXTURE_DIR / "release_gate_evidence.local_alpha.json", "object"),
    ("release_gate_evidence.schema.json", FIXTURE_DIR / "release_gate_evidence.ci.json", "object"),
    (
        "release_gate_evidence.schema.json",
        FIXTURE_DIR / "release_gate_evidence.private_beta_staging.json",
        "object",
    ),
    (
        "release_gate_evidence.schema.json",
        FIXTURE_DIR / "release_gate_evidence.production_launch.json",
        "object",
    ),
]

CHECKED_ITEMS = {
    "定义 eval suite schema。",
    "实现 eval runner。",
    "存储 eval results。",
    "skill canary 前要求 eval pass。",
    "prompt fragment active 前要求 eval pass。",
    "创建四条 workflow golden fixtures。",
    "创建 ambiguous/unsafe/negative fixtures。",
    "创建 brand/product preservation fixtures。",
    "创建 text-heavy fixtures。",
    "创建 export completeness fixtures。",
    "定义 QA result schema。",
    "实现 file integrity/dimensions/aspect/safe-area QA。",
    "实现 blank/duplicate/four-option distinctness QA。",
    "实现 text readability 或 manual-review placeholder。",
    "实现 structured text QA。",
    "实现 product/logo preservation QA。",
    "实现 forbidden claims QA。",
    "实现 export completeness QA。",
    "实现 safety rule schema。",
    "定义并验证 brief/provider request/provider response/QA/export safety policy contract evidence。",
    "实现 red-team fixtures。",
    "定义 vertical acceptance schema。",
    "实现电商增长包 acceptance fixture。",
    "实现商业视觉文档包 acceptance fixture。",
    "实现本地商家活动包 acceptance fixture。",
    "实现角色/IP 概念包 acceptance fixture。",
    "每条 workflow 定义 required inputs。",
    "每条 workflow 定义 clarification questions。",
    "每条 workflow 定义 4-option taxonomy。",
    "每条 workflow 定义 required package outputs。",
    "每条 workflow 定义 QA/safety/export pass thresholds。",
    "实现 admin crawler source approval evidence。",
    "实现 source legal metadata。",
    "添加 disallowed source、robots denied、duplicate hash、pending-review import tests。",
    "实现 feedback taxonomy。",
    "实现 feedback attribution。",
    "实现 support ticket 前端上下文：project/task/trace/asset/export/quota 可见并随 report problem 生成。",
    "实现 admin support ticket 关联证据视图：user/trace/export/quota/audit 引用可查。",
    "support ticket 后端持久化并强制关联 user/project/task/trace/asset/export/quota。",
    "实现 abuse event model。",
    "实现 temporary hold/throttle hooks admin fixture/evidence。",
    "temporary hold/throttle hooks runtime enforcement 通过。",
    "实现 admin abuse queue fixture/evidence。",
    "admin abuse queue runtime enforcement 通过。",
    "实现 secure cookie 和 same-site CSRF 客户端/session contract evidence。",
    "配置 Web/generated client CSRF same-site request contract。",
    "实现 secret redaction。",
    "CI 定义 Playwright smoke draft/evidence。",
    "CI 定义 Docker image build draft/evidence。",
    "定义 staging deploy plan。",
    "定义 request id propagation staging smoke contract。",
    "定义 structured JSON logs contract。",
    "定义 OpenTelemetry traces contract。",
    "定义 backend/worker/crawler metrics contract。",
    "定义 dashboards。",
    "定义 alerts。",
    "定义 analytics event taxonomy。",
    "添加 trace completeness tests。",
    "定义 release gate evidence schema/fixtures 和 no-go release notes renderer。",
    "定义 post-deploy smoke evidence contract。",
    PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_CHECKLIST_ITEM,
    "Backfill Local Alpha release gate fixture evidence: workflow/eval/crawler/schema/service/runtime-stack checks pass in `fixtures/stage0/rev2/release_gate_evidence.local_alpha.json`。",
    "Backfill CI draft/no-go evidence: ops CI draft coverage passes while installed `.github/workflows` runtime remains blocked in `fixtures/stage0/rev2/release_gate_evidence.ci.json`。",
    "Backfill Private Beta/Staging no-go evidence: contract/fixture evidence is separated from external-user staging runtime blockers in `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json`。",
    "Backfill Production Launch no-go evidence: provider/billing/skill/activation/abuse/security/backup/legal blockers remain active in `fixtures/stage0/rev2/release_gate_evidence.production_launch.json`。",
}

FORBIDDEN_CHECKED_ITEMS = {
    "实现 crawler source approval。",
    "实现 provenance links。",
    "CI 运行 Playwright smoke。",
    "CI build Docker images。",
    "实现 staging deploy。",
    "实现 staging smoke tests。",
    "配置 CSRF 或 same-site strategy。",
    "实现 dashboards。",
    "实现 alerts。",
    "Post-deploy smoke tests 通过。",
    "Production post-deploy smoke tests 通过。",
}

REQUIRED_OPEN_ITEMS = {
    "Local Alpha workflow API/Playwright end-to-end smoke evidence 通过并写入 release gate fixture。",
    "CI installed workflow runtime evidence 通过：PR/main run、Playwright smoke、Docker image build 均有 validator-resolvable evidence。",
    "Private Beta/Staging external-user runtime evidence 通过：auth/RBAC/tenant、storage、quota/rate limit、support/abuse、safety/QA/crawler、observability/backup/load、legal visibility 均有 staging evidence。",
    "Production Launch runtime/deployment evidence 通过：provider-or-comp-only、paid lifecycle、skill canary、activation audit、abuse hold、security、backup/rollback/post-deploy smoke、legal/support policy 均有 production evidence。",
    "电商增长包 API smoke test 通过。",
    "电商增长包 Playwright happy path 通过。",
    "电商增长包 export ZIP evidence 通过：`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    "商业视觉文档包 API smoke test 通过。",
    "商业视觉文档包 Playwright happy path 通过。",
    "商业视觉文档包 export ZIP evidence 通过：`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    "本地商家活动包 API smoke test 通过。",
    "本地商家活动包 Playwright happy path 通过。",
    "本地商家活动包 export ZIP evidence 通过：`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    "角色/IP 概念包 API smoke test 通过。",
    "角色/IP 概念包 Playwright happy path 通过。",
    "角色/IP 概念包 export ZIP evidence 通过：`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    "Local Alpha 电商增长包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/ecommerce_growth_pack.api_smoke.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` 均证明 running local stack。",
    "Local Alpha 商业视觉文档包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/business_visual_doc_pack.api_smoke.json`、`ops/evidence/local_alpha/business_visual_doc_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` 均证明 running local stack。",
    "Local Alpha 本地商家活动包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/local_merchant_campaign_pack.api_smoke.json`、`ops/evidence/local_alpha/local_merchant_campaign_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` 均证明 running local stack。",
    "Local Alpha 角色/IP 概念包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/character_ip_concept_pack.api_smoke.json`、`ops/evidence/local_alpha/character_ip_concept_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` 均证明 running local stack。",
    "CI 在已安装 PR/main workflow 中运行 Playwright smoke。",
    "CI 在已安装 PR/main workflow 中 build Docker images。",
    "执行 staging deploy。",
    "执行 staging smoke tests。",
    "Staging post-deploy smoke tests 通过。",
    PRODUCTION_POST_DEPLOY_LAUNCH_CLEARING_CHECKLIST_ITEM,
}
REQUIRED_OPEN_ITEMS |= set(CI_RUNTIME_OPEN_CHECK_ITEMS)
CLOSED_CHECK_LEVEL_RUNTIME_ITEMS = {
    "Private Beta/Staging auth/RBAC/tenant/audit runtime evidence 通过。",
    "Private Beta/Staging brief/upload/confirmation runtime evidence 通过。",
    "Private Beta/Staging crawler approval/provenance runtime evidence 通过。",
    "Private Beta/Staging eval/QA/safety enforcement runtime evidence 通过。",
    "Private Beta/Staging quota/rate-limit/spend-cap runtime evidence 通过。",
    "Private Beta/Staging support/retry/abuse runtime evidence 通过。",
    "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。",
    "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
    "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。",
    "Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。",
    "Private Beta/Staging observability/backup/load runtime evidence 通过。",
    "Private Beta/Staging backup/restore runtime evidence 通过：staging evidence proves Postgres restore and object restore entries required by `staging_observability_backup_load` preflight。",
    "Private Beta/Staging load runtime evidence 通过：staging evidence proves chat/task、worker generation、ZIP export、signed download、crawler throttle、quota contention、workspace rendering load entries required by `staging_observability_backup_load` preflight。",
    "staging backend/worker/crawler metrics runtime evidence 通过。",
    "Production skill release/eval/canary runtime/deployment evidence 通过。",
    "Production activation review/audit runtime/deployment evidence 通过。",
    "Production abuse throttle/hold runtime/deployment evidence 通过。",
    "Production security launch-check runtime/deployment evidence 通过。",
    PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_CHECKLIST_ITEM,
}
REQUIRED_OPEN_ITEMS |= (
    RELEASE_GATE_CHECK_LEVEL_RUNTIME_OPEN_ITEMS.keys()
    - CLOSED_CHECK_LEVEL_RUNTIME_ITEMS
    - {STAGING_OBSERVABILITY_RUNTIME_CHECKLIST_ITEM}
)
REQUIRED_OPEN_ITEMS |= set(LOCAL_ALPHA_RELEASE_GATE_WORKFLOW_RUNTIME_OPEN_CHECK_ITEMS)
REQUIRED_OPEN_ITEMS -= {
    "电商增长包 API smoke test 通过。",
    "电商增长包 Playwright happy path 通过。",
    "商业视觉文档包 API smoke test 通过。",
    "商业视觉文档包 Playwright happy path 通过。",
    "Local Alpha 电商增长包 runtime smoke evidence 写入 release gate fixture：`ops/evidence/local_alpha/ecommerce_growth_pack.api_smoke.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.playwright_happy_path.json`、`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` 均证明 running local stack。",
    "执行 staging deploy。",
    "执行 staging smoke tests。",
    "Staging post-deploy smoke tests 通过。",
    "staging backend/worker/crawler metrics runtime evidence 通过。",
    STAGING_OBSERVABILITY_RUNTIME_CHECKLIST_ITEM,
    "Private Beta/Staging eval/QA/safety enforcement runtime evidence 通过。",
    "Private Beta/Staging quota/rate-limit/spend-cap runtime evidence 通过。",
    "Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。",
    "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。",
    "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
    "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。",
    "Private Beta/Staging observability/backup/load runtime evidence 通过。",
    "Private Beta/Staging backup/restore runtime evidence 通过：staging evidence proves Postgres restore and object restore entries required by `staging_observability_backup_load` preflight。",
    "Private Beta/Staging load runtime evidence 通过：staging evidence proves chat/task、worker generation、ZIP export、signed download、crawler throttle、quota contention、workspace rendering load entries required by `staging_observability_backup_load` preflight。",
    "Production skill release/eval/canary runtime/deployment evidence 通过。",
    "Production activation review/audit runtime/deployment evidence 通过。",
    "Production abuse throttle/hold runtime/deployment evidence 通过。",
    "Production security launch-check runtime/deployment evidence 通过。",
    PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_CHECKLIST_ITEM,
    "电商增长包 API smoke test 通过。",
    "电商增长包 Playwright happy path 通过。",
    "电商增长包 export ZIP evidence 通过：`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    "商业视觉文档包 API smoke test 通过。",
    "商业视觉文档包 Playwright happy path 通过。",
    "商业视觉文档包 export ZIP evidence 通过：`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    *LOCAL_ALPHA_RELEASE_GATE_WORKFLOW_RUNTIME_CLOSED_ITEMS.keys(),
}

CRAWLER_GOVERNANCE_SPLIT_ITEMS = {
    "source_approval": {
        "contract_item": "实现 admin crawler source approval evidence。",
        "runtime_item": "backend/local crawler fetch/import runtime 强制 source approval gate。",
    },
    "robots_evidence": {
        "contract_item": "定义 robots evidence fixture/contract。",
        "runtime_item": "backend/local crawler runtime 强制 robots evidence。",
    },
    "ssrf_protection": {
        "contract_item": "定义 SSRF protection fixture/contract：private IP blocking、redirect validation、DNS rebinding guard。",
        "runtime_item": "backend/local crawler runtime 强制 SSRF protections。",
    },
    "rate_limits": {
        "contract_item": "定义 source/global rate limit fixture/contract。",
        "runtime_item": "backend/local crawler runtime 强制 source/global rate limits。",
    },
    "retention": {
        "contract_item": "定义 raw content retention fixture/contract。",
        "runtime_item": "backend/local crawler runtime 强制 raw content retention limit。",
    },
    "exact_text_warning": {
        "contract_item": "定义 exact-text import warning fixture/contract。",
        "runtime_item": "backend/local crawler runtime 强制 exact-text import warning。",
    },
    "provenance_links": {
        "contract_item": "定义 provenance links fixture/contract。",
        "runtime_item": "backend/local crawler runtime 强制 provenance links。",
    },
    "source_blocklist": {
        "contract_item": "定义 source blocklist fixture/contract。",
        "runtime_item": "backend/local crawler runtime 强制 source blocklist。",
    },
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
    "listAnalyticsEvents",
    "listAnalyticsReports",
    "listEvalResults",
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
    "AnalyticsEvent:",
    "AnalyticsReport:",
    "EvalResult:",
    "go_no_go_signal:",
    "privacy_classification:",
}

ANALYTICS_EVENTS = {
    "signup",
    "onboarding_completed",
    "project_created",
    "first_chat_sent",
    "candidate_set_generated",
    "candidate_selected",
    "iteration_requested",
    "package_item_added",
    "export_started",
    "export_completed",
    "export_failed",
    "qa_warning_block",
    "billing_viewed",
    "subscription_started_cancelled",
    "support_ticket_opened",
    "safety_blocked",
}

ANALYTICS_REPORTS = {
    "first_prompt_to_four_candidates",
    "four_option_selection_rate",
    "iteration_rate",
    "package_add_rate",
    "export_completion_rate",
    "weekly_return",
    "average_assets_per_package",
    "cost_per_successful_package",
    "qa_warning_block_rate",
    "failed_export_rate",
    "support_ticket_rate",
    "provider_cost_anomaly",
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

WORKFLOW_ACCEPTANCE_SPLITS = {
    "ecommerce_growth_pack": {
        "fixture_item": "实现电商增长包 acceptance fixture。",
        "api_item": "电商增长包 API smoke test 通过。",
        "playwright_item": "电商增长包 Playwright happy path 通过。",
        "export_item": "电商增长包 export ZIP evidence 通过：`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
        "ambiguous_item": "实现电商增长包 fixture/API test/Playwright test。",
    },
    "business_visual_doc_pack": {
        "fixture_item": "实现商业视觉文档包 acceptance fixture。",
        "api_item": "商业视觉文档包 API smoke test 通过。",
        "playwright_item": "商业视觉文档包 Playwright happy path 通过。",
        "export_item": "商业视觉文档包 export ZIP evidence 通过：`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
        "ambiguous_item": "实现商业视觉文档包 fixture/API test/Playwright test。",
    },
    "local_merchant_campaign_pack": {
        "fixture_item": "实现本地商家活动包 acceptance fixture。",
        "api_item": "本地商家活动包 API smoke test 通过。",
        "playwright_item": "本地商家活动包 Playwright happy path 通过。",
        "export_item": "本地商家活动包 export ZIP evidence 通过：`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
        "ambiguous_item": "实现本地商家活动包 fixture/API test/Playwright test。",
    },
    "character_ip_concept_pack": {
        "fixture_item": "实现角色/IP 概念包 acceptance fixture。",
        "api_item": "角色/IP 概念包 API smoke test 通过。",
        "playwright_item": "角色/IP 概念包 Playwright happy path 通过。",
        "export_item": "角色/IP 概念包 export ZIP evidence 通过：`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
        "ambiguous_item": "实现角色/IP 概念包 fixture/API test/Playwright test。",
    },
}

WORKFLOW_RUNTIME_EVIDENCE_REQUIREMENTS = {
    "api_item": {
        "contract_key": "api_smoke_contract",
        "status_label": "API smoke",
        "required_status": "executed",
        "required_evidence_terms": ("api", "smoke"),
    },
    "playwright_item": {
        "contract_key": "playwright_happy_path_contract",
        "status_label": "Playwright happy path",
        "required_status": "executed",
        "required_evidence_terms": ("playwright", "happy path"),
    },
    "export_item": {
        "contract_key": None,
        "status_label": "export ZIP",
        "required_status": "executed",
        "required_evidence_terms": (
            "export zip",
            "manifest",
            "qa report",
            "safety",
            "provenance",
            "metadata",
            "ai disclaimer",
            "trace",
            "taxonomy",
        ),
    },
}

WORKFLOW_RUNTIME_CLOSED_ITEMS = {
    "ecommerce_growth_pack": {
        "api_item",
        "playwright_item",
        "export_item",
    },
    "business_visual_doc_pack": {
        "api_item",
        "playwright_item",
        "export_item",
    },
}

LOCAL_ALPHA_E2E_WORKFLOW_EVIDENCE_REQUIREMENTS = {
    "ecommerce_growth_pack": (
        "ecommerce_growth_pack",
        "电商增长包",
    ),
    "business_visual_doc_pack": (
        "business_visual_doc_pack",
        "商业视觉文档包",
    ),
    "local_merchant_campaign_pack": (
        "local_merchant_campaign_pack",
        "本地商家活动包",
    ),
    "character_ip_concept_pack": (
        "character_ip_concept_pack",
        "角色/IP 概念包",
    ),
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


def normalize_evidence_path(path: str) -> str:
    return path.rstrip(".,;:)。")


def evidence_path_exists(path: str) -> bool:
    normalized = normalize_evidence_path(path)
    if normalized == ".github":
        return (ROOT / ".github").exists()
    candidate = repo_path(normalized)
    if candidate.exists():
        return True
    if "{" in normalized or "*" in normalized:
        glob_pattern = re.sub(r"\{([^{}]+)\}", r"*", normalized).replace("*", "*")
        return any(ROOT.glob(glob_pattern))
    return False


def concrete_evidence_paths(evidence_ref: str) -> set[str]:
    paths: set[str] = set()
    for match in CONCRETE_EVIDENCE_PATH_RE.finditer(evidence_ref):
        path = normalize_evidence_path(match.group(1))
        if path.startswith(CONCRETE_EVIDENCE_PATH_PREFIXES):
            paths.add(path)
    return paths


def require_concrete_evidence_ref(
    evidence_ref: str,
    context: str,
    *,
    require_all_paths_exist: bool = True,
) -> None:
    paths = concrete_evidence_paths(evidence_ref)
    require(paths, f"{context} must cite at least one concrete repo artifact path")
    if require_all_paths_exist:
        missing_paths = sorted(path for path in paths if not evidence_path_exists(path))
        require(
            not missing_paths,
            f"{context} cites concrete repo artifact paths that do not exist: {missing_paths}",
        )
    require(
        any(evidence_path_exists(path) for path in paths),
        f"{context} cites repo artifact paths but none exist: {sorted(paths)}",
    )


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def load_json_if_path(path: str) -> Any | None:
    candidate = repo_path(normalize_evidence_path(path))
    if not candidate.is_file() or candidate.suffix != ".json":
        return None
    try:
        return json.loads(candidate.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def require_evidence_ref_cites_files(
    evidence_ref: str,
    paths: list[Path],
    context: str,
) -> None:
    missing_refs = [rel(path) for path in paths if rel(path) not in evidence_ref]
    require(
        not missing_refs,
        f"{context} must cite exact evidence file paths: {missing_refs}",
    )
    missing_files = [rel(path) for path in paths if not path.exists()]
    require(not missing_files, f"{context} cites missing evidence files: {missing_files}")


def require_local_alpha_workflow_runtime_files(
    evidence_ref: str,
    context: str,
    workflow_id: str | None = None,
) -> None:
    workflow_files = (
        {workflow_id: LOCAL_ALPHA_WORKFLOW_RUNTIME_EVIDENCE_FILES[workflow_id]}
        if workflow_id is not None
        else LOCAL_ALPHA_WORKFLOW_RUNTIME_EVIDENCE_FILES
    )
    required_files = [
        path
        for files in workflow_files.values()
        for path in files.values()
    ]
    require_evidence_ref_cites_files(evidence_ref, required_files, context)
    for path in required_files:
        evidence = load_json_if_path(rel(path))
        require(evidence is not None, f"{context} evidence file is not readable JSON: {rel(path)}")
        require(evidence.get("status") == "pass", f"{context} evidence file must pass: {rel(path)}")
        require(
            evidence.get("environment") == "local_alpha",
            f"{context} evidence file must be local_alpha: {rel(path)}",
        )
        if workflow_id is not None:
            require(
                evidence.get("workflow_id") == workflow_id,
                f"{context} evidence file workflow mismatch: {rel(path)}",
            )
        actual_workflow_id = evidence.get("workflow_id")
        require(
            actual_workflow_id in workflow_files,
            f"{context} evidence file {rel(path)} references unexpected workflow_id={actual_workflow_id!r}",
        )
        expected_kind = next(
            evidence_kind
            for evidence_kind, expected_path in workflow_files[actual_workflow_id].items()
            if expected_path == path
        )
        validate_local_alpha_workflow_runtime_evidence_file(
            evidence,
            workflow_id=actual_workflow_id,
            evidence_kind=expected_kind,
            path=rel(path),
            context=context,
        )


def require_local_alpha_single_workflow_runtime_files(
    evidence_ref: str,
    workflow_id: str,
    context: str,
    evidence_kinds: set[str] | None = None,
) -> None:
    require(
        workflow_id in LOCAL_ALPHA_WORKFLOW_RUNTIME_EVIDENCE_FILES,
        f"{context} references unknown Local Alpha workflow {workflow_id}",
    )
    workflow_files = LOCAL_ALPHA_WORKFLOW_RUNTIME_EVIDENCE_FILES[workflow_id]
    selected_kinds = evidence_kinds if evidence_kinds is not None else set(workflow_files)
    unknown_kinds = selected_kinds - set(workflow_files)
    require(not unknown_kinds, f"{context} references unknown Local Alpha evidence kinds: {sorted(unknown_kinds)}")
    required_files = [workflow_files[kind] for kind in sorted(selected_kinds)]
    require_evidence_ref_cites_files(evidence_ref, required_files, context)
    for runtime_path in required_files:
        evidence = load_json_if_path(rel(runtime_path))
        require(isinstance(evidence, dict), f"{context} evidence file is not readable JSON: {rel(runtime_path)}")
        require(
            evidence.get("environment") in RUNTIME_PASS_FILE_ENVIRONMENTS["local_alpha"],
            f"{context} evidence file {rel(runtime_path)} must declare local/local_alpha environment",
        )
        require(
            evidence.get("workflow_id") == workflow_id,
            f"{context} evidence file {rel(runtime_path)} targets workflow_id={evidence.get('workflow_id')!r}",
        )
        require(
            evidence.get("release_gate_check_id") == "local_alpha_e2e_workflow_smoke",
            f"{context} evidence file {rel(runtime_path)} must target local_alpha_e2e_workflow_smoke",
        )
        require(
            evidence.get("status") in RUNTIME_PASS_EVIDENCE_STATUS_VALUES,
            f"{context} evidence file {rel(runtime_path)} must itself be passing; got status={evidence.get('status')!r}",
        )
        require(
            evidence.get("proves_running_local_stack") is True,
            f"{context} evidence file {rel(runtime_path)} must prove the running local stack",
        )
        evidence_kind = next(kind for kind, expected_path in workflow_files.items() if expected_path == runtime_path)
        validate_local_alpha_workflow_runtime_evidence_file(
            evidence,
            workflow_id=workflow_id,
            evidence_kind=evidence_kind,
            path=rel(runtime_path),
            context=context,
        )


def validate_local_alpha_workflow_runtime_evidence_file(
    evidence: dict[str, Any],
    *,
    workflow_id: str,
    evidence_kind: str,
    path: str,
    context: str,
) -> None:
    expected_evidence_kind = {
        "api": "api_smoke",
        "playwright": "playwright_happy_path",
        "export": "export_zip",
    }[evidence_kind]
    require(
        evidence.get("evidence_kind") == expected_evidence_kind,
        f"{context} {path} must declare evidence_kind={expected_evidence_kind!r}",
    )
    require(
        evidence.get("workflow_id") == workflow_id,
        f"{context} {path} must target workflow_id={workflow_id!r}",
    )
    require(
        evidence.get("release_gate_check_id") == "local_alpha_e2e_workflow_smoke",
        f"{context} {path} must target local_alpha_e2e_workflow_smoke",
    )
    require(
        evidence.get("environment") == "local_alpha",
        f"{context} {path} must be local_alpha evidence",
    )
    require(
        evidence.get("status") in RUNTIME_PASS_EVIDENCE_STATUS_VALUES,
        f"{context} {path} must have a passing runtime status",
    )

    if evidence_kind == "api":
        operation_ids = set(evidence.get("operation_ids", []))
        required_operations = {
            "createChatSession",
            "createChatMessage",
            "createCandidateSet",
            "listCandidateAssets",
            "selectDirection",
            "createPackage",
            "createExport",
            "getExport",
        }
        require(
            required_operations <= operation_ids,
            f"{context} {path} API smoke evidence missing operations: {sorted(required_operations - operation_ids)}",
        )
        assertions = evidence.get("assertions")
        require(isinstance(assertions, dict), f"{context} {path} API smoke evidence missing assertions")
        require(assertions.get("status") == "pass", f"{context} {path} API assertions must pass")
        require(assertions.get("candidate_count") == 4, f"{context} {path} must prove exactly four candidates")
        require(assertions.get("taxonomy_count") == 4, f"{context} {path} must prove four distinct taxonomy options")
        require(assertions.get("ready_zip_export_count", 0) >= 1, f"{context} {path} must prove ready ZIP export")
        require(assertions.get("missing_output_count") == 0, f"{context} {path} must prove no missing outputs")
        require(assertions.get("qa_taxonomy_status") == "pass", f"{context} {path} must prove QA taxonomy pass")
        require(assertions.get("safety_status") == "pass", f"{context} {path} must prove safety pass")
    elif evidence_kind == "playwright":
        steps = set(evidence.get("interaction_steps", []))
        required_step_groups = {
            "brief": {"brief_confirmed"},
            "reference": {"reference_uploaded", "source_notes_uploaded"},
            "four_candidates": {"four_candidates_visible", "four_document_candidates_visible"},
            "candidate_selected": {"candidate_selected"},
            "iteration": {"iteration_created"},
            "taxonomy_packaged": {"all_taxonomy_candidates_packaged", "all_document_taxonomy_candidates_packaged"},
            "zip_export": {"zip_export_created"},
            "download": {"download_handoff_completed"},
        }
        missing_step_groups = [
            group
            for group, aliases in required_step_groups.items()
            if steps.isdisjoint(aliases)
        ]
        require(
            not missing_step_groups,
            f"{context} {path} Playwright evidence missing interaction step groups: {missing_step_groups}",
        )
        export_ui = evidence.get("export_metadata_ui")
        require(isinstance(export_ui, dict), f"{context} {path} missing export metadata UI evidence")
        require(export_ui.get("status") == "pass", f"{context} {path} export metadata UI evidence must pass")
        require(export_ui.get("zipPayloadParityStatus") == "pass", f"{context} {path} must prove ZIP/UI parity")
        require(
            export_ui.get("traceProvenancePayloadPresent") == "true",
            f"{context} {path} must prove trace provenance payload",
        )
        require(
            export_ui.get("aiContentDisclaimerPayloadPresent") == "true",
            f"{context} {path} must prove AI disclaimer payload",
        )
        require(str(evidence.get("downloaded_file_name", "")).endswith(".zip"), f"{context} {path} must prove ZIP download handoff")
    elif evidence_kind == "export":
        payloads = set(evidence.get("payloads", []))
        required_payloads = {
            "manifest.json",
            "qa-report.json",
            "safety-policy-report.json",
            "provenance.json",
            "ai-content-disclaimer.json",
            "ppt-ready-metadata.json",
            "metadata.json",
            "qa_report.json",
            "trace_provenance.json",
        }
        require(
            required_payloads <= payloads,
            f"{context} {path} export ZIP evidence missing payloads: {sorted(required_payloads - payloads)}",
        )
        require(not evidence.get("missing_payloads"), f"{context} {path} must have no missing ZIP payloads")
        require(evidence.get("byte_size", 0) > 0, f"{context} {path} must record a non-empty ZIP")
        manifest = evidence.get("manifest")
        require(isinstance(manifest, dict), f"{context} {path} must include parsed manifest evidence")
        require(manifest.get("item_count") == 4, f"{context} {path} manifest must prove four packaged items")
        require(manifest.get("required_output_count", 0) > 0, f"{context} {path} manifest must prove required outputs")
        workflow_acceptance = manifest.get("workflow_acceptance")
        require(isinstance(workflow_acceptance, dict), f"{context} {path} must include workflow acceptance metadata")
        require(
            workflow_acceptance.get("workflow_id") == workflow_id,
            f"{context} {path} workflow acceptance metadata must match workflow_id={workflow_id!r}",
        )
        require(
            len(workflow_acceptance.get("strategy_taxonomy", [])) == 4,
            f"{context} {path} must prove four-option strategy taxonomy in the export",
        )
        qa_report = evidence.get("qa_report")
        safety_report = evidence.get("safety_report")
        require(isinstance(qa_report, dict), f"{context} {path} must include QA report evidence")
        require(qa_report.get("blocking_count") == 0, f"{context} {path} must prove no blocking QA findings")
        require(isinstance(safety_report, dict), f"{context} {path} must include safety report evidence")
        require(safety_report.get("status") == "pass", f"{context} {path} must prove safety pass")
        require(
            set(safety_report.get("enforcement_stages", [])) == SAFETY_POINTS,
            f"{context} {path} must prove safety enforcement at every stage",
        )


def require_runtime_file_evidence(evidence_ref: str, gate: str, check_id: str) -> None:
    allowed_prefixes = RUNTIME_PASS_FILE_PREFIXES.get(gate, ())
    require(allowed_prefixes, f"{gate}.{check_id} has no runtime file evidence prefix contract")
    allowed_environments = RUNTIME_PASS_FILE_ENVIRONMENTS.get(gate, set())
    require(allowed_environments, f"{gate}.{check_id} has no runtime environment contract")
    concrete_paths = concrete_evidence_paths(evidence_ref)
    forbidden_prefixes = FORBIDDEN_RUNTIME_GATE_PATH_PREFIXES.get(gate, ())
    forbidden_paths = [
        path
        for path in concrete_paths
        if any(path.startswith(prefix) for prefix in forbidden_prefixes)
    ]
    require(
        not forbidden_paths,
        f"{gate}.{check_id} pass evidence cites cross-environment runtime evidence paths that cannot close this gate: "
        + json.dumps(sorted(forbidden_paths), ensure_ascii=False),
    )
    runtime_paths = [
        path
        for path in concrete_paths
        if any(path.startswith(prefix) for prefix in allowed_prefixes)
    ]
    existing_runtime_files = [
        path
        for path in runtime_paths
        if repo_path(path).is_file()
    ]
    require(
        existing_runtime_files,
        f"{gate}.{check_id} pass evidence must cite at least one exact existing runtime evidence file under "
        + json.dumps(allowed_prefixes, ensure_ascii=False)
        + "; directory-only evidence is insufficient",
    )
    for runtime_path in existing_runtime_files:
        evidence = load_json_if_path(runtime_path)
        if evidence is None:
            continue
        actual_environment = evidence.get("environment")
        require(
            actual_environment in allowed_environments,
            f"{gate}.{check_id} pass evidence file {runtime_path} must declare one of "
            f"{sorted(allowed_environments)}; got environment={actual_environment!r}",
        )
        if "status" in evidence:
            require(
                evidence.get("status") in RUNTIME_PASS_EVIDENCE_STATUS_VALUES,
                f"{gate}.{check_id} pass evidence file {runtime_path} must itself be passing; "
                f"got status={evidence.get('status')!r}",
            )
        evidence_check_id = evidence.get("release_gate_check_id")
        if evidence_check_id is not None:
            require(
                evidence_check_id == check_id,
                f"{gate}.{check_id} pass evidence file {runtime_path} targets release_gate_check_id={evidence_check_id!r}",
            )
        blocked_slots = evidence.get("blocked_slots")
        require(
            not blocked_slots,
            f"{gate}.{check_id} pass evidence file {runtime_path} has blocked_slots={blocked_slots!r}",
        )
        missing_blockers = evidence.get("missing_blockers")
        require(
            not missing_blockers,
            f"{gate}.{check_id} pass evidence file {runtime_path} has missing_blockers={missing_blockers!r}",
        )
        gate_impact = evidence.get("gate_impact")
        if isinstance(gate_impact, dict):
            preserved_check_id = gate_impact.get("preserved_release_gate_check_id")
            if preserved_check_id is not None:
                require(
                    preserved_check_id == check_id,
                    f"{gate}.{check_id} pass evidence file {runtime_path} preserves mismatched check {preserved_check_id!r}",
                )
        require_runtime_evidence_back_reference(
            evidence,
            runtime_path=runtime_path,
            gate=gate,
            check_id=check_id,
        )


def gate_impact_checklist_values(gate_impact: dict[str, Any]) -> set[str]:
    values: set[str] = set()
    for key in [
        "checklist_item",
        "check_level_item",
        "aggregate_checklist_item",
    ]:
        value = gate_impact.get(key)
        if isinstance(value, str) and value.strip():
            values.add(value)
    checklist_items = gate_impact.get("checklist_items")
    if isinstance(checklist_items, list):
        values.update(item for item in checklist_items if isinstance(item, str) and item.strip())
    for key, checklist_item in GATE_IMPACT_KEY_CHECKLIST_ITEMS.items():
        if gate_impact.get(key) is True:
            values.add(checklist_item)
    return values


def require_runtime_evidence_back_reference(
    evidence: dict[str, Any],
    *,
    runtime_path: str,
    gate: str,
    check_id: str,
) -> None:
    if not runtime_path.startswith("ops/evidence/"):
        return
    expected_items = RUNTIME_EVIDENCE_CHECKLIST_ITEMS.get((gate, check_id), set())
    if not expected_items:
        return
    evidence_check_id = evidence.get("release_gate_check_id")
    require(
        evidence_check_id == check_id,
        f"{gate}.{check_id} runtime evidence file {runtime_path} must explicitly target "
        f"release_gate_check_id={check_id!r}; got {evidence_check_id!r}",
    )
    gate_impact = evidence.get("gate_impact")
    require(
        isinstance(gate_impact, dict),
        f"{gate}.{check_id} runtime evidence file {runtime_path} must include gate_impact",
    )
    checklist_values = gate_impact_checklist_values(gate_impact)
    require(
        checklist_values & expected_items,
        f"{gate}.{check_id} runtime evidence file {runtime_path} must name one validator-owned checklist row; "
        f"expected one of {sorted(expected_items)} but got {sorted(checklist_values)}",
    )


def require_staging_observability_backup_load_pass_evidence(evidence_ref: str) -> None:
    cited_json_paths = [
        path
        for path in sorted(concrete_evidence_paths(evidence_ref))
        if path.startswith("ops/evidence/staging/") and path.endswith(".json")
    ]
    matching_reports: list[tuple[str, dict[str, Any]]] = []
    for path in cited_json_paths:
        evidence = load_json_if_path(path)
        if not isinstance(evidence, dict):
            continue
        if evidence.get("kind") == "staging_observability_backup_load_preflight":
            matching_reports.append((path, evidence))

    require(
        matching_reports,
        "private_beta_staging.staging_observability_backup_load pass evidence must cite an exact "
        "ops/evidence/staging/*.json preflight report with kind=staging_observability_backup_load_preflight",
    )

    passed_reports = [
        (path, evidence)
        for path, evidence in matching_reports
        if evidence.get("status") == "passed"
    ]
    require(
        passed_reports,
        "private_beta_staging.staging_observability_backup_load pass evidence cites only blocked or non-passing "
        "staging observability/backup/load/post-deploy preflight reports",
    )

    required_slots = {
        "observability_evidence": {
            "alert_routes",
            "backend_worker_crawler_metrics",
            "dashboard_import",
            "opentelemetry_traces",
            "request_id_propagation",
            "structured_json_logs",
        },
        "backup_restore_evidence": {"object_restore", "postgres_restore"},
        "load_evidence": {
            "chat_task",
            "crawler_throttle",
            "quota_contention",
            "signed_download",
            "worker_generation",
            "workspace_rendering",
            "zip_export",
        },
        "post_deploy_smoke_evidence": {
            "admin",
            "auth_boundary",
            "backend_health",
            "crawler_admin",
            "export_package",
            "observability",
            "quota_rate_limit",
            "signed_download",
            "web",
            "worker_task",
        },
    }
    required_summary_entries = {
        "verified_observability_entries": required_slots["observability_evidence"],
        "verified_postgres_restore_entries": {"postgres_restore"},
        "verified_object_restore_entries": {"object_restore"},
        "verified_load_entries": required_slots["load_evidence"],
        "verified_post_deploy_smoke_entries": required_slots["post_deploy_smoke_evidence"],
    }
    for path, evidence in passed_reports:
        require(
            evidence.get("environment") == "staging",
            f"{path} must be staging-scoped",
        )
        require(
            evidence.get("release_gate_check_id") == "staging_observability_backup_load",
            f"{path} must target release_gate_check_id=staging_observability_backup_load",
        )
        require(
            evidence.get("evidence_path_policy") == "ops/evidence/staging/",
            f"{path} must keep staging evidence under ops/evidence/staging/",
        )
        require(
            not evidence.get("blocked_slots"),
            f"{path} must not contain blocked_slots when status=passed",
        )
        require(evidence.get("overall_verified") is True, f"{path} must set overall_verified=true")
        require(not evidence.get("missing_blockers"), f"{path} must not preserve missing blockers")
        for field, required_entries in required_summary_entries.items():
            actual_entries = set(evidence.get(field, []))
            require(
                actual_entries == required_entries,
                f"{path} {field} must exactly match required entries: "
                + json.dumps(sorted(required_entries), ensure_ascii=False),
            )
        gate_impact = evidence.get("gate_impact")
        require(isinstance(gate_impact, dict), f"{path} must include gate_impact")
        require(
            gate_impact.get("can_clear_aggregate_item") is True,
            f"{path} must explicitly allow aggregate observability/backup/load checklist closure",
        )
        require(
            gate_impact.get("preserved_release_gate_check_id") is None,
            f"{path} must not preserve staging_observability_backup_load after passing",
        )
        require(
            gate_impact.get("preserved_do_not_launch_condition_id") is None,
            f"{path} must not preserve staging_observability_restore_load_missing after passing",
        )

        checks = evidence.get("checks")
        require(isinstance(checks, list), f"{path} must include preflight checks")
        checks_by_slot = {
            check.get("slot"): check
            for check in checks
            if isinstance(check, dict)
        }
        require(
            set(required_slots) <= set(checks_by_slot),
            f"{path} missing required preflight slots: {sorted(set(required_slots) - set(checks_by_slot))}",
        )
        for slot, required_entries in required_slots.items():
            check = checks_by_slot[slot]
            require(check.get("verified") is True, f"{path} {slot} must be verified")
            require(
                check.get("expected_environment") == "staging",
                f"{path} {slot} must expect staging environment",
            )
            require(
                not check.get("missing_entries"),
                f"{path} {slot} must not have missing entries",
            )
            require(
                not check.get("entries_missing_evidence_refs"),
                f"{path} {slot} entries must cite evidence refs",
            )
            actual_entries = set(check.get("required_entries", []))
            require(
                required_entries <= actual_entries,
                f"{path} {slot} missing required entries: {sorted(required_entries - actual_entries)}",
            )
            semantic_checks = check.get("semantic_checks")
            require(isinstance(semantic_checks, dict), f"{path} {slot} must include semantic checks")
            for semantic_key in [
                "environment_staging",
                "kind_match",
                "local_json_file",
                "release_sha_match",
                "release_sha_present",
                "required_entries_have_evidence_refs",
                "required_entries_passed",
                "required_entries_present",
                "status_passed",
            ]:
                require(
                    semantic_checks.get(semantic_key) is True,
                    f"{path} {slot} semantic check {semantic_key} must be true",
                )
        return

    fail("no valid staging observability/backup/load pass evidence found")


def require_split_runtime_pass_evidence(evidence_ref: str, gate: str, check_id: str) -> None:
    requirement = RUNTIME_SPLIT_PASS_REQUIREMENTS.get((gate, check_id))
    if requirement is None:
        return

    evidence_ref_lower = evidence_ref.lower()
    for subitem_id, path in requirement["subitems"].items():
        rel_path = rel(path)
        require(
            rel_path in evidence_ref,
            f"{gate}.{check_id} pass evidence must cite exact split runtime evidence for {subitem_id}: {rel_path}",
        )
        evidence = load_json_if_path(rel_path)
        require(
            isinstance(evidence, dict),
            f"{gate}.{check_id} split runtime evidence {rel_path} must exist and be valid JSON",
        )
        require(
            evidence.get("environment") in RUNTIME_PASS_FILE_ENVIRONMENTS[gate],
            f"{gate}.{check_id} split runtime evidence {rel_path} has wrong environment={evidence.get('environment')!r}",
        )
        evidence_check_id = evidence.get("release_gate_check_id")
        if evidence_check_id is not None:
            require(
                evidence_check_id == check_id,
                f"{gate}.{check_id} split runtime evidence {rel_path} targets release_gate_check_id={evidence_check_id!r}",
            )
        require(
            evidence.get("status") in RUNTIME_PASS_EVIDENCE_STATUS_VALUES,
            f"{gate}.{check_id} split runtime evidence {rel_path} must be passing; got status={evidence.get('status')!r}",
        )
        blockers = runtime_evidence_preserved_blockers(evidence)
        if evidence.get("status") == "pass_with_blockers_preserved":
            require(
                subitem_id == "signed_url",
                f"{gate}.{check_id} split runtime evidence {rel_path} preserves blockers for unsupported subitem {subitem_id}",
            )
            require(
                rel(STAGING_OBJECT_STORAGE_RETENTION_EVIDENCE) in evidence_ref,
                f"{gate}.{check_id} signed URL evidence may preserve retention blockers only when retention cleanup evidence is also cited",
            )
        else:
            require(
                not blockers,
                f"{gate}.{check_id} split runtime evidence {rel_path} cannot preserve blockers when closing combined check: {blockers}",
            )
        missing_tokens = [
            token
            for token in requirement["tokens"][subitem_id]
            if token not in evidence_ref_lower and token not in json.dumps(evidence, ensure_ascii=False).lower()
        ]
        require(
            not missing_tokens,
            f"{gate}.{check_id} split runtime evidence {rel_path} missing required coverage tokens for {subitem_id}: {missing_tokens}",
        )


def split_checklist_requirement_for_path(
    gate: str,
    check_id: str,
    path: Path,
) -> tuple[str, dict[str, Any]] | tuple[None, None]:
    for item, requirement in SPLIT_CHECKLIST_ITEM_EVIDENCE.items():
        if (
            requirement["gate"] == gate
            and requirement["check_id"] == check_id
            and requirement["path"] == path
        ):
            return item, requirement
    return None, None


def split_checklist_items_for_path(
    gate: str,
    check_id: str,
    path: Path,
) -> list[tuple[str, dict[str, Any]]]:
    return [
        (item, requirement)
        for item, requirement in SPLIT_CHECKLIST_ITEM_EVIDENCE.items()
        if (
            requirement["gate"] == gate
            and requirement["check_id"] == check_id
            and requirement["path"] == path
        )
    ]


def split_runtime_evidence_is_passable(path: Path, requirement: dict[str, Any]) -> bool:
    if not path.is_file():
        return False
    evidence = load_json_if_path(rel(path))
    if not isinstance(evidence, dict):
        return False
    if evidence.get("environment") not in RUNTIME_PASS_FILE_ENVIRONMENTS[requirement["gate"]]:
        return False
    evidence_check_id = evidence.get("release_gate_check_id")
    if evidence_check_id is not None and evidence_check_id != requirement["check_id"]:
        return False
    if evidence.get("status") not in requirement["allowed_statuses"]:
        return False
    preserved_blockers = runtime_evidence_preserved_blockers(evidence)
    if requirement["allow_preserved_blockers"]:
        if not preserved_blockers:
            return False
    elif preserved_blockers:
        return False
    combined = json.dumps(evidence, ensure_ascii=False).lower()
    return all(token in combined for token in requirement["tokens"])


def split_release_check_may_remain_blocked_after_exact_evidence(
    gate: str,
    check_id: str,
    evidence_by_gate: dict[str, dict[str, Any]],
) -> bool:
    if (gate, check_id) != ("production_launch", "production_backup_rollback_incident"):
        return False
    return not (
        gate_allows_checklist_completion(evidence_by_gate["ci"])
        and gate_allows_checklist_completion(evidence_by_gate["private_beta_staging"])
    )


def validate_split_release_check_state(
    evidence_by_gate: dict[str, dict[str, Any]],
    checked_lines: set[str],
    unchecked_lines: set[str],
) -> None:
    for (gate, check_id), requirement in RUNTIME_SPLIT_PASS_REQUIREMENTS.items():
        gate_evidence = evidence_by_gate[gate]
        check = checks_by_id(gate_evidence)[check_id]
        subitem_states: dict[str, dict[str, Any]] = {}
        for subitem_id, path in requirement["subitems"].items():
            checklist_requirements = split_checklist_items_for_path(gate, check_id, path)
            require(
                checklist_requirements,
                f"{gate}.{check_id} split evidence {rel(path)} has no validator-owned checklist row",
            )
            passable_by_any_row = any(
                split_runtime_evidence_is_passable(path, checklist_requirement)
                for _, checklist_requirement in checklist_requirements
            )
            checked_rows = [
                item
                for item, _ in checklist_requirements
                if item in checked_lines
            ]
            unchecked_rows = [
                item
                for item, _ in checklist_requirements
                if item in unchecked_lines
            ]
            unknown_rows = [
                item
                for item, _ in checklist_requirements
                if item not in checked_lines and item not in unchecked_lines
            ]
            require(
                not unknown_rows,
                f"{gate}.{check_id} split evidence checklist row is missing from blueprint: {unknown_rows}",
            )
            subitem_states[subitem_id] = {
                "path": rel(path),
                "passable": passable_by_any_row,
                "checked_rows": checked_rows,
                "unchecked_rows": unchecked_rows,
            }

        all_split_files_passable = all(state["passable"] for state in subitem_states.values())
        all_owned_rows_checked = all(state["checked_rows"] for state in subitem_states.values())

        if check["status"] == "pass":
            failing_subitems = {
                subitem_id: state
                for subitem_id, state in subitem_states.items()
                if not state["passable"]
            }
            require(
                not failing_subitems,
                f"{gate}.{check_id} cannot pass before every exact split evidence file is passable: "
                + json.dumps(failing_subitems, ensure_ascii=False, sort_keys=True),
            )
            open_rows = {
                subitem_id: state["unchecked_rows"]
                for subitem_id, state in subitem_states.items()
                if state["unchecked_rows"]
            }
            require(
                not open_rows,
                f"{gate}.{check_id} cannot pass while exact split checklist rows remain open: "
                + json.dumps(open_rows, ensure_ascii=False, sort_keys=True),
            )
        else:
            if all_split_files_passable and all_owned_rows_checked:
                require(
                    split_release_check_may_remain_blocked_after_exact_evidence(
                        gate,
                        check_id,
                        evidence_by_gate,
                    ),
                    f"{gate}.{check_id} remains {check['status']} even though all exact split evidence files "
                    "are passable and their checklist rows are closed",
                )


def require_split_runtime_blocked_evidence(evidence_ref: str, gate: str, check_id: str) -> None:
    requirement = RUNTIME_SPLIT_PASS_REQUIREMENTS.get((gate, check_id))
    if requirement is None:
        return

    evidence_ref_lower = evidence_ref.lower()
    for subitem_id, path in requirement["subitems"].items():
        rel_path = rel(path)
        require(
            rel_path in evidence_ref,
            f"{gate}.{check_id} blocked evidence must name exact required split runtime evidence for "
            f"{subitem_id}: {rel_path}",
        )
        missing_tokens = [
            token
            for token in requirement["tokens"][subitem_id]
            if token not in evidence_ref_lower
        ]
        require(
            not missing_tokens,
            f"{gate}.{check_id} blocked split evidence {rel_path} missing required blocker tokens "
            f"for {subitem_id}: {missing_tokens}",
        )
        path_index = evidence_ref.find(rel_path)
        require(
            path_index >= 0,
            f"{gate}.{check_id} blocked split evidence must cite exact required path {rel_path}",
        )
        before_start = max(
            evidence_ref_lower.rfind(separator, 0, path_index)
            for separator in (".", ";", ":")
        )
        before_start = 0 if before_start < 0 else before_start + 1
        after_candidates = [
            evidence_ref_lower.find(separator, path_index + len(rel_path))
            for separator in (".", ";")
        ]
        after_candidates = [index for index in after_candidates if index >= 0]
        after_end = min(after_candidates) if after_candidates else len(evidence_ref_lower)
        path_context = evidence_ref_lower[before_start:after_end]
        path_window = evidence_ref_lower[
            max(0, path_index - 180) : min(len(evidence_ref_lower), path_index + len(rel_path) + 180)
        ]
        if path.exists():
            evidence = load_json_if_path(rel_path)
            require(
                evidence is None or isinstance(evidence, dict),
                f"{gate}.{check_id} blocked split evidence {rel_path} must be valid JSON when present",
            )
            checklist_item, checklist_requirement = split_checklist_requirement_for_path(gate, check_id, path)
            require(
                checklist_requirement is not None,
                f"{gate}.{check_id} blocked split evidence {rel_path} is not owned by an exact checklist row",
            )
            require(
                any(term in path_window for term in SPLIT_EVIDENCE_PRESENT_TERMS),
                f"{gate}.{check_id} blocked split evidence {rel_path} exists but evidence_ref does not mark "
                f"that split as present/pass; stale missing prose cannot preserve a blocker",
            )
            require(
                not any(term in path_window for term in SPLIT_EVIDENCE_ABSENT_TERMS),
                f"{gate}.{check_id} blocked split evidence {rel_path} exists but evidence_ref still describes "
                f"that exact file as missing/absent",
            )
            if isinstance(evidence, dict):
                environment = evidence.get("environment")
                if environment is not None:
                    require(
                        environment in RUNTIME_PASS_FILE_ENVIRONMENTS[gate],
                        f"{gate}.{check_id} blocked split evidence {rel_path} has wrong environment={environment!r}",
                    )
                evidence_check_id = evidence.get("release_gate_check_id")
                if evidence_check_id is not None:
                    require(
                        evidence_check_id == check_id,
                        f"{gate}.{check_id} blocked split evidence {rel_path} targets "
                        f"release_gate_check_id={evidence_check_id!r}",
                    )
                require(
                    evidence.get("status") in checklist_requirement["allowed_statuses"],
                    f"{gate}.{check_id} blocked split evidence {rel_path} has status={evidence.get('status')!r}; "
                    f"it cannot be cited as present for {checklist_item}",
                )
                preserved_blockers = runtime_evidence_preserved_blockers(evidence)
                if checklist_requirement["allow_preserved_blockers"]:
                    require(
                        preserved_blockers,
                        f"{gate}.{check_id} blocked split evidence {rel_path} must preserve the combined blocker",
                    )
                else:
                    require(
                        not preserved_blockers,
                        f"{gate}.{check_id} blocked split evidence {rel_path} must not preserve blockers: "
                        f"{preserved_blockers}",
                    )
                combined = json.dumps(evidence, ensure_ascii=False).lower()
                missing_evidence_tokens = [
                    token
                    for token in checklist_requirement["tokens"]
                    if token not in combined
                ]
                require(
                    not missing_evidence_tokens,
                    f"{gate}.{check_id} blocked split evidence {rel_path} lacks required checked-row semantics "
                    f"for {checklist_item}: {missing_evidence_tokens}",
                )
        else:
            require(
                any(term in path_window for term in SPLIT_EVIDENCE_ABSENT_TERMS),
                f"{gate}.{check_id} blocked split evidence {rel_path} is missing but evidence_ref does not "
                f"describe that exact split file as absent/missing",
            )
            require(
                not any(term in path_context for term in SPLIT_EVIDENCE_PRESENT_TERMS),
                f"{gate}.{check_id} blocked split evidence {rel_path} is missing but evidence_ref describes "
                f"that exact file as present/pass",
            )


def validate_split_checklist_item_evidence(
    checked_lines: set[str],
    unchecked_lines: set[str],
) -> None:
    for item, requirement in SPLIT_CHECKLIST_ITEM_EVIDENCE.items():
        item_state_count = int(item in checked_lines) + int(item in unchecked_lines)
        require(item_state_count == 1, f"split runtime checklist item is missing: {item}")
        if item in unchecked_lines:
            path = requirement["path"]
            require(
                not split_runtime_evidence_is_passable(path, requirement),
                f"split runtime checklist item remains open even though exact evidence is passable at {rel(path)}: {item}",
            )
            continue

        gate = requirement["gate"]
        check_id = requirement["check_id"]
        path = requirement["path"]
        rel_path = rel(path)
        require(
            path.exists(),
            f"checked split runtime checklist item requires exact evidence file {rel_path}: {item}",
        )
        evidence = load_json(path)
        expected_environments = RUNTIME_PASS_FILE_ENVIRONMENTS[gate]
        require(
            evidence.get("environment") in expected_environments,
            f"checked split runtime evidence {rel_path} must declare one of "
            f"{sorted(expected_environments)}; got environment={evidence.get('environment')!r}",
        )
        evidence_check_id = evidence.get("release_gate_check_id")
        if evidence_check_id is not None:
            require(
                evidence_check_id == check_id,
                f"checked split runtime evidence {rel_path} targets release_gate_check_id={evidence_check_id!r}",
            )
        require(
            evidence.get("status") in requirement["allowed_statuses"],
            f"checked split runtime evidence {rel_path} status={evidence.get('status')!r} is not allowed for {item}",
        )
        preserved_blockers = runtime_evidence_preserved_blockers(evidence)
        if requirement["allow_preserved_blockers"]:
            require(
                preserved_blockers,
                f"checked partial split runtime evidence {rel_path} must preserve the combined release-gate blocker",
            )
        else:
            require(
                not preserved_blockers,
                f"checked split runtime evidence {rel_path} must not preserve blockers: {preserved_blockers}",
            )
        combined = json.dumps(evidence, ensure_ascii=False).lower()
        missing_tokens = [
            token
            for token in requirement["tokens"]
            if token not in combined
        ]
        require(
            not missing_tokens,
            f"checked split runtime evidence {rel_path} missing required semantics for {item}: {missing_tokens}",
        )


def require_check_level_evidence_gate_impact(
    evidence: dict[str, Any],
    *,
    gate: str,
    check_id: str,
    evidence_name: str,
) -> None:
    checklist_item = CHECK_LEVEL_EVIDENCE_TO_CHECKLIST_ITEM[(gate, check_id)]
    expected_minimum_remaining = CHECK_LEVEL_EVIDENCE_PRESERVED_BLOCKERS[(gate, check_id)]
    expected_current_remaining = current_blocked_release_gate_checks(gate) - {check_id}
    gate_impact = evidence["gate_impact"]
    actual_checklist_item = gate_impact.get("checklist_item") or gate_impact.get("check_level_item")
    require(
        actual_checklist_item == checklist_item,
        f"{evidence_name} must name the exact check-level checklist item it can clear",
    )
    require(
        gate_impact.get("can_clear_check_level_item") is True,
        f"{evidence_name} must explicitly allow only check-level closure",
    )
    remaining_blockers = set(gate_impact.get("remaining_blockers", []))
    require(
        check_id not in remaining_blockers,
        f"{evidence_name} must not list its own cleared check as a remaining blocker: {check_id}",
    )
    require(
        expected_minimum_remaining <= remaining_blockers,
        f"{evidence_name} must preserve at least the current remaining release-gate blockers: "
        + json.dumps(sorted(expected_minimum_remaining), ensure_ascii=False),
    )
    require(
        remaining_blockers == expected_current_remaining,
        f"{evidence_name} remaining_blockers must exactly match current blocked checks in "
        f"{rel(RELEASE_GATE_EVIDENCE_FILES[gate])}: "
        + json.dumps(sorted(expected_current_remaining), ensure_ascii=False),
    )
    if gate == "private_beta_staging":
        require(
            gate_impact.get("aggregate_private_beta_gate_status") == "blocked_by_other_staging_runtime_items",
            f"{evidence_name} must keep the aggregate private beta gate blocked",
        )
    elif gate == "production_launch":
        require(
            gate_impact.get("aggregate_production_gate_status") == "blocked_by_other_production_runtime_items",
            f"{evidence_name} must keep the aggregate production gate blocked",
        )


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
    expected_files = set(RELEASE_GATE_EVIDENCE_FILES.values())
    actual_files = set(FIXTURE_DIR.glob("release_gate_evidence.*.json"))
    unexpected_files = actual_files - expected_files
    missing_files = expected_files - actual_files
    require(
        not unexpected_files,
        "unexpected release gate evidence fixture files: "
        + json.dumps(
            sorted(str(path.relative_to(ROOT)) for path in unexpected_files),
            ensure_ascii=False,
        ),
    )
    require(
        not missing_files,
        "missing release gate evidence fixture files: "
        + json.dumps(
            sorted(str(path.relative_to(ROOT)) for path in missing_files),
            ensure_ascii=False,
        ),
    )
    for path in sorted(expected_files):
        data = load_json(path)
        expected_gate = next(
            gate
            for gate, expected_path in RELEASE_GATE_EVIDENCE_FILES.items()
            if expected_path == path
        )
        require(
            data["gate"] == expected_gate,
            f"{path.relative_to(ROOT)} gate must be {expected_gate!r}",
        )
        require(
            data.get("evidence_id") == RELEASE_GATE_EVIDENCE_IDS[expected_gate],
            f"{path.relative_to(ROOT)} evidence_id must be {RELEASE_GATE_EVIDENCE_IDS[expected_gate]!r}",
        )
        require(
            expected_gate not in evidence,
            f"duplicate release gate evidence for {expected_gate}: {path.relative_to(ROOT)}",
        )
        evidence[data["gate"]] = data
    return evidence


def gate_allows_checklist_completion(data: dict[str, Any]) -> bool:
    return all(check["status"] == "pass" for check in data["checks"]) and not any(
        item["is_present"] for item in data["do_not_launch_checks"]
    )


def gate_decision_status(data: dict[str, Any]) -> str:
    decision = data.get("gate_decision")
    require(isinstance(decision, dict), f"{data['gate']} release evidence missing gate_decision")
    status = decision.get("status")
    require(isinstance(status, str), f"{data['gate']} gate_decision.status must be a string")
    return status


def gate_blockers(data: dict[str, Any]) -> dict[str, list[str]]:
    return {
        "blocked_or_failing_checks": [
            check["check_id"]
            for check in data["checks"]
            if check["status"] != "pass"
        ],
        "active_do_not_launch_conditions": [
            item["condition_id"]
            for item in data["do_not_launch_checks"]
            if item["is_present"]
        ],
    }


def require_unique_ordered_ids(ids: list[Any], context: str) -> None:
    require(
        all(isinstance(item, str) and item.strip() for item in ids),
        f"{context} must contain only non-empty string IDs",
    )
    require(
        len(ids) == len(set(ids)),
        f"{context} must not contain duplicate IDs",
    )


def current_blocked_release_gate_checks(gate: str) -> set[str]:
    data = load_json(RELEASE_GATE_EVIDENCE_FILES[gate])
    return {
        check["check_id"]
        for check in data["checks"]
        if check["status"] != "pass"
    }


def validate_gate_decision(data: dict[str, Any]) -> None:
    gate = data["gate"]
    decision = data.get("gate_decision")
    require(isinstance(decision, dict), f"{gate} release evidence missing gate_decision")

    blockers = gate_blockers(data)
    expected_blocked_checks = blockers["blocked_or_failing_checks"]
    expected_active_conditions = blockers["active_do_not_launch_conditions"]
    expected_status = (
        "go"
        if not expected_blocked_checks and not expected_active_conditions
        else "no_go"
    )
    decision_blocked_checks = decision.get("blocked_by_checks", [])
    decision_active_conditions = decision.get("active_do_not_launch_conditions", [])
    require(
        isinstance(decision_blocked_checks, list),
        f"{gate} gate_decision.blocked_by_checks must be a list",
    )
    require(
        isinstance(decision_active_conditions, list),
        f"{gate} gate_decision.active_do_not_launch_conditions must be a list",
    )
    require_unique_ordered_ids(
        [check.get("check_id") for check in data["checks"]],
        f"{gate} release evidence checks.check_id",
    )
    require_unique_ordered_ids(
        [condition.get("condition_id") for condition in data["do_not_launch_checks"]],
        f"{gate} release evidence do_not_launch_checks.condition_id",
    )
    require_unique_ordered_ids(
        decision_blocked_checks,
        f"{gate} gate_decision.blocked_by_checks",
    )
    require_unique_ordered_ids(
        decision_active_conditions,
        f"{gate} gate_decision.active_do_not_launch_conditions",
    )
    unknown_decision_checks = set(decision_blocked_checks) - {
        check["check_id"] for check in data["checks"]
    }
    unknown_decision_conditions = set(decision_active_conditions) - {
        condition["condition_id"] for condition in data["do_not_launch_checks"]
    }
    require(
        not unknown_decision_checks,
        f"{gate} gate_decision.blocked_by_checks contains IDs outside checks.check_id: "
        + json.dumps(sorted(unknown_decision_checks), ensure_ascii=False),
    )
    require(
        not unknown_decision_conditions,
        f"{gate} gate_decision.active_do_not_launch_conditions contains IDs outside do_not_launch_checks.condition_id: "
        + json.dumps(sorted(unknown_decision_conditions), ensure_ascii=False),
    )
    require(
        decision.get("status") == expected_status,
        f"{gate} gate_decision.status must be {expected_status!r} based on computed blockers",
    )
    require(
        decision_blocked_checks == expected_blocked_checks,
        f"{gate} gate_decision.blocked_by_checks must match blocked/failing checks in fixture order: {expected_blocked_checks}",
    )
    require(
        decision_active_conditions == expected_active_conditions,
        f"{gate} gate_decision.active_do_not_launch_conditions must match active Do-Not-Launch conditions in fixture order: {expected_active_conditions}",
    )
    evidence_ref = decision.get("evidence_ref", "")
    require(
        isinstance(evidence_ref, str) and evidence_ref.strip(),
        f"{gate} gate_decision.evidence_ref must be non-empty",
    )
    require_concrete_evidence_ref(
        evidence_ref,
        f"{gate} gate_decision evidence",
    )
    require(
        rel(RELEASE_GATE_EVIDENCE_FILES[gate]) in evidence_ref,
        f"{gate} gate_decision evidence must cite its release gate fixture",
    )
    if expected_status == "no_go":
        require(
            "no-go" in evidence_ref.lower() or "no_go" in evidence_ref.lower() or "blocked" in evidence_ref.lower(),
            f"{gate} gate_decision no-go evidence must explicitly state the blocked launch decision",
        )
        evidence_ref_lower = evidence_ref.lower()
        missing_check_ids = [
            check_id
            for check_id in expected_blocked_checks
            if check_id.lower() not in evidence_ref_lower
        ]
        require(
            not missing_check_ids,
            f"{gate} gate_decision no-go evidence must name every blocked/failing check ID: {missing_check_ids}",
        )
        missing_condition_ids = [
            condition_id
            for condition_id in expected_active_conditions
            if condition_id.lower() not in evidence_ref_lower
        ]
        require(
            not missing_condition_ids,
            f"{gate} gate_decision no-go evidence must name every active Do-Not-Launch condition ID: {missing_condition_ids}",
        )
    else:
        require(
            "go" in evidence_ref.lower(),
            f"{gate} gate_decision go evidence must explicitly state the launch decision",
        )


def checks_by_id(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    checks = data["checks"]
    check_ids = [check["check_id"] for check in checks]
    require(
        len(check_ids) == len(set(check_ids)),
        f"{data['gate']} release evidence has duplicate check_id values",
    )
    return {check["check_id"]: check for check in checks}


def do_not_launch_by_id(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    conditions = data["do_not_launch_checks"]
    condition_ids = [condition["condition_id"] for condition in conditions]
    require(
        len(condition_ids) == len(set(condition_ids)),
        f"{data['gate']} release evidence has duplicate condition_id values",
    )
    return {condition["condition_id"]: condition for condition in conditions}


def validate_release_gate_basics(data: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    gate = data["gate"]
    require(gate in RELEASE_GATE_REQUIRED_CHECKS, f"unexpected release gate evidence target: {gate}")
    require(
        data.get("schema_version") == "stage0.rev2",
        f"{gate} release evidence schema_version must be stage0.rev2",
    )
    require(
        data.get("evidence_id") == RELEASE_GATE_EVIDENCE_IDS[gate],
        f"{gate} release evidence_id must be {RELEASE_GATE_EVIDENCE_IDS[gate]!r}",
    )
    require(
        data["provenance"]["created_by_lane"] == "lane6",
        f"{gate} release evidence must be lane6-owned",
    )
    require(
        data["provenance"]["blueprint_sections"],
        f"{gate} release evidence must cite blueprint sections",
    )
    validate_gate_decision(data)

    checks = checks_by_id(data)
    missing_checks = RELEASE_GATE_REQUIRED_CHECKS[gate] - set(checks)
    extra_checks = set(checks) - RELEASE_GATE_REQUIRED_CHECKS[gate]
    require(not missing_checks, f"{gate} release evidence missing checks: {sorted(missing_checks)}")
    require(
        not extra_checks,
        f"{gate} release evidence has unknown checks that are not defined by the Rev2 gate contract: {sorted(extra_checks)}",
    )

    conditions = do_not_launch_by_id(data)
    expected_conditions = set(DO_NOT_LAUNCH_CONDITION_COVERAGE[gate])
    extra_conditions = set(conditions) - expected_conditions
    require(
        not extra_conditions,
        f"{gate} release evidence has unknown Do-Not-Launch condition IDs: {sorted(extra_conditions)}",
    )
    for check_id, check in checks.items():
        require(
            check["status"] in CHECK_STATUS_VALUES,
            f"{gate}.{check_id} has unsupported status {check['status']!r}",
        )
        require(
            check["status"] in REQUIRED_RELEASE_GATE_CHECK_STATUS_VALUES,
            f"{gate}.{check_id} is a required release gate check and cannot use "
            "`not_applicable`; missing evidence must be blocked or fail",
        )
        require(
            check["evidence_ref"].strip(),
            f"{gate}.{check_id} must have a non-empty evidence_ref",
        )
        if check["status"] in {"fail", "blocked"}:
            evidence_ref_lower = check["evidence_ref"].lower()
            require(
                any(token in evidence_ref_lower for token in BLOCKED_RUNTIME_EVIDENCE_TERMS),
                f"{gate}.{check_id} is {check['status']} but evidence_ref does not explain the blocker",
            )
            require(
                any(token in evidence_ref_lower for token in BLOCKED_GATE_EVIDENCE_TERMS),
                f"{gate}.{check_id} is {check['status']} but evidence_ref does not name missing runtime/deployment evidence",
            )
        if check["status"] == "pass":
            require_concrete_evidence_ref(
                check["evidence_ref"],
                f"{gate}.{check_id} pass evidence",
            )

    for condition_id, condition in conditions.items():
        require(
            condition["evidence_ref"].strip(),
            f"{gate}.{condition_id} must have a non-empty evidence_ref",
        )
        if condition["is_present"]:
            require(
                any(
                    token in condition["evidence_ref"].lower()
                    for token in [
                        "absent",
                        "blocked",
                        "blocker",
                        "missing",
                        "remain",
                        "requires",
                        "cannot close",
                        "not ",
                        "no ",
                        "until",
                        "未",
                        "缺",
                        "open",
                    ]
                ),
                f"{gate}.{condition_id} is active but evidence_ref does not explain the launch blocker",
            )
            require_concrete_evidence_ref(
                condition["evidence_ref"],
                f"{gate}.{condition_id} active condition evidence",
                require_all_paths_exist=False,
            )
        else:
            require_concrete_evidence_ref(
                condition["evidence_ref"],
                f"{gate}.{condition_id} cleared condition",
            )

    return checks, conditions


def validate_do_not_launch_condition_coverage(data: dict[str, Any]) -> None:
    gate = data["gate"]
    expected = DO_NOT_LAUNCH_CONDITION_COVERAGE[gate]
    conditions = do_not_launch_by_id(data)
    missing = set(expected) - set(conditions)
    extra = set(conditions) - set(expected)
    require(not missing, f"{gate} release evidence missing Do-Not-Launch coverage: {sorted(missing)}")
    require(
        not extra,
        f"{gate} release evidence has Do-Not-Launch coverage outside the validator-owned Rev2 map: {sorted(extra)}",
    )
    for condition_id, blueprint_text in expected.items():
        require(
            conditions[condition_id].get("blueprint_condition") == blueprint_text,
            f"{gate}.{condition_id} must cite exact blueprint Do-Not-Launch condition text",
        )


def validate_active_condition_evidence_refs(data: dict[str, Any]) -> None:
    gate = data["gate"]
    conditions = do_not_launch_by_id(data)
    for condition_id, condition in conditions.items():
        if not condition["is_present"]:
            continue
        requirement = ACTIVE_CONDITION_EVIDENCE_REQUIREMENTS.get((gate, condition_id))
        require(
            requirement is not None,
            f"{gate}.{condition_id} has no active Do-Not-Launch evidence requirement",
        )
        evidence_ref = condition["evidence_ref"]
        evidence_ref_lower = evidence_ref.lower()
        missing_tokens = [
            token
            for token in requirement["tokens"]
            if token not in evidence_ref_lower
        ]
        require(
            not missing_tokens,
            f"{gate}.{condition_id} active blocker evidence missing required terms: {missing_tokens}",
        )
        require(
            any(re.search(pattern, evidence_ref) for pattern in requirement["path_patterns"]),
            f"{gate}.{condition_id} active blocker evidence must cite gate-specific repository evidence paths: "
            + json.dumps(requirement["path_patterns"]),
        )


def validate_pass_evidence_does_not_cite_blocked_runtime_artifacts(data: dict[str, Any]) -> None:
    gate = data["gate"]
    for check_id, check in checks_by_id(data).items():
        if check["status"] != "pass":
            continue
        for path in sorted(concrete_evidence_paths(check["evidence_ref"])):
            evidence = load_json_if_path(path)
            if not isinstance(evidence, dict):
                continue
            status = evidence.get("status")
            is_runtime_evidence = path.startswith("ops/evidence/") or "release_gate_check_id" in evidence
            if is_runtime_evidence:
                require(
                    status in RUNTIME_PASS_EVIDENCE_STATUS_VALUES,
                    f"{gate}.{check_id} pass evidence cites non-passing runtime artifact {path} with status={status!r}",
                )
            blocked_slots = evidence.get("blocked_slots")
            require(
                not blocked_slots,
                f"{gate}.{check_id} pass evidence cites runtime artifact {path} with blocked_slots={blocked_slots!r}",
            )
            missing_blockers = evidence.get("missing_blockers")
            require(
                not missing_blockers,
                f"{gate}.{check_id} pass evidence cites runtime artifact {path} with missing_blockers={missing_blockers!r}",
            )
            preserved_blockers = runtime_evidence_preserved_blockers(evidence)
            if path not in PARTIAL_RUNTIME_PASS_EVIDENCE_ALLOWLIST:
                require(
                    not preserved_blockers,
                    f"{gate}.{check_id} pass evidence cites blocker-preserving runtime artifact {path}: "
                    + json.dumps(preserved_blockers, ensure_ascii=False),
                )


def runtime_evidence_preserved_blockers(evidence: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    status = evidence.get("status")
    if status == "pass_with_blockers_preserved":
        blockers.append("status=pass_with_blockers_preserved")
    for field in ["blocked_slots", "missing_blockers", "closure_blockers"]:
        value = evidence.get(field)
        if value:
            blockers.append(f"{field}={value!r}")
    gate_impact = evidence.get("gate_impact")
    if isinstance(gate_impact, dict):
        remaining_blockers = gate_impact.get("remaining_blockers")
        if remaining_blockers:
            blockers.append(f"gate_impact.remaining_blockers={remaining_blockers!r}")
        blocked_slots = gate_impact.get("blocked_slots")
        if blocked_slots:
            blockers.append(f"gate_impact.blocked_slots={blocked_slots!r}")
        closure_blockers = gate_impact.get("closure_blockers")
        if closure_blockers:
            blockers.append(f"gate_impact.closure_blockers={closure_blockers!r}")
        if gate_impact.get("can_clear_aggregate_item") is False:
            blockers.append("gate_impact.can_clear_aggregate_item=false")
        if gate_impact.get("preserved_release_gate_check_id"):
            blockers.append(
                f"gate_impact.preserved_release_gate_check_id={gate_impact['preserved_release_gate_check_id']!r}"
            )
        if gate_impact.get("preserved_do_not_launch_condition_id"):
            blockers.append(
                "gate_impact.preserved_do_not_launch_condition_id="
                f"{gate_impact['preserved_do_not_launch_condition_id']!r}"
            )
    return blockers


def validate_closed_gate_items_do_not_cite_preserved_blocker_evidence(
    gate: str,
    data: dict[str, Any],
    checked_lines: set[str],
) -> None:
    closure_items = {
        item
        for item, item_gate in GATE_CHECKLIST_ITEMS.items()
        if item_gate == gate and item in checked_lines
    }
    aggregate_item = RELEASE_GATE_AGGREGATE_ITEMS[gate]
    if aggregate_item in checked_lines:
        closure_items.add(aggregate_item)
    if GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM in checked_lines:
        closure_items.add(GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM)
    if gate_decision_status(data) == "go":
        closure_items.add(f"{gate} gate_decision.status=go")
    if not closure_items:
        return

    for check_id, check in checks_by_id(data).items():
        if check["status"] != "pass":
            continue
        for path in sorted(concrete_evidence_paths(check["evidence_ref"])):
            evidence = load_json_if_path(path)
            if not isinstance(evidence, dict):
                continue
            preserved_blockers = runtime_evidence_preserved_blockers(evidence)
            require(
                not preserved_blockers,
                f"{gate}.{check_id} cannot support closed gate/global checklist items "
                f"{sorted(closure_items)} with blocker-preserving runtime artifact {path}: "
                + json.dumps(preserved_blockers, ensure_ascii=False),
            )


def validate_check_condition_consistency(data: dict[str, Any]) -> None:
    gate = data["gate"]
    checks = checks_by_id(data)
    conditions = do_not_launch_by_id(data)
    active_condition_to_blocked_checks: dict[str, list[str]] = {
        condition_id: []
        for condition_id, condition in conditions.items()
        if condition["is_present"]
    }
    for check_id, condition_ids in RELEASE_GATE_CHECK_BLOCKING_CONDITIONS.get(gate, {}).items():
        require(check_id in checks, f"{gate} condition guard references unknown check {check_id}")
        missing_conditions = condition_ids - set(conditions)
        require(
            not missing_conditions,
            f"{gate}.{check_id} condition guard references unknown Do-Not-Launch IDs: "
            + json.dumps(sorted(missing_conditions), ensure_ascii=False),
        )
        active_conditions = [
            condition_id
            for condition_id in sorted(condition_ids)
            if conditions[condition_id]["is_present"]
        ]
        if checks[check_id]["status"] in {"blocked", "fail"} and gate in {
            "ci",
            "private_beta_staging",
            "production_launch",
        }:
            require(
                active_conditions,
                f"{gate}.{check_id} is {checks[check_id]['status']} but has no active mapped Do-Not-Launch condition",
            )
            for condition_id in active_conditions:
                active_condition_to_blocked_checks[condition_id].append(check_id)
        if checks[check_id]["status"] == "pass":
            require(
                not active_conditions,
                f"{gate}.{check_id} cannot pass while related Do-Not-Launch conditions are active: "
                + json.dumps(active_conditions, ensure_ascii=False),
            )
        if active_conditions:
            require(
                checks[check_id]["status"] != "pass",
                f"{gate}.{check_id} must stay blocked/failing while related Do-Not-Launch conditions are active: "
                + json.dumps(active_conditions, ensure_ascii=False),
            )
    for condition_id, blocked_check_ids in active_condition_to_blocked_checks.items():
        if gate not in {"ci", "private_beta_staging", "production_launch"}:
            continue
        require(
            blocked_check_ids,
            f"{gate}.{condition_id} is active but is not mapped to a blocked/failing release gate check",
        )


def validate_no_go_condition_visibility(data: dict[str, Any]) -> None:
    gate = data["gate"]
    blockers = gate_blockers(data)
    blocked_checks = blockers["blocked_or_failing_checks"]
    active_conditions = blockers["active_do_not_launch_conditions"]
    decision_status = data["gate_decision"]["status"]
    if gate == "local_alpha":
        if decision_status != "no_go" or active_conditions:
            return
        allowed_blockers = {"local_alpha_e2e_workflow_smoke"}
        require(
            set(blocked_checks).issubset(allowed_blockers),
            "local_alpha may have no active Do-Not-Launch condition only for local workflow smoke evidence; "
            f"unexpected blockers: {blocked_checks}",
        )
        evidence_ref = data["gate_decision"]["evidence_ref"].lower()
        for token in ["workflow", "api", "playwright", "export"]:
            require(
                token in evidence_ref,
                "local_alpha no-go without active Do-Not-Launch conditions must explain missing "
                f"per-workflow runtime evidence: {token}",
            )
        return

    if decision_status == "no_go":
        require(
            active_conditions,
            f"{gate} gate_decision is no_go but has no active Do-Not-Launch condition",
        )
    for condition_id in active_conditions:
        require(
            condition_id in RELEASE_GATE_REQUIRED_ACTIVE_CONDITIONS[gate],
            f"{gate}.{condition_id} is active but is not an allowed launch-blocking condition",
        )


def validate_global_do_not_launch_condition_coverage(evidence: dict[str, dict[str, Any]]) -> None:
    blueprint_conditions = blueprint_do_not_launch_conditions()
    fixture_conditions = {
        condition["blueprint_condition"]
        for data in evidence.values()
        for condition in data["do_not_launch_checks"]
    }
    missing = blueprint_conditions - fixture_conditions
    extra = fixture_conditions - blueprint_conditions
    require(
        not missing,
        "release gate evidence does not cover every section 24 Do-Not-Launch condition: "
        + json.dumps(sorted(missing), ensure_ascii=False),
    )
    require(
        not extra,
        "release gate evidence cites unknown Do-Not-Launch conditions: "
        + json.dumps(sorted(extra), ensure_ascii=False),
    )


def validate_gate_cannot_pass_with_open_items(
    gate: str,
    data: dict[str, Any],
    unchecked_lines: set[str],
) -> None:
    relevant_open_items = RELEASE_GATE_PASS_BLOCKED_BY_OPEN_ITEMS.get(gate, set()) & unchecked_lines
    if relevant_open_items:
        require(
            not gate_allows_checklist_completion(data),
            f"{gate} gate evidence allows checklist completion while blocking checklist items remain open: "
            + json.dumps(sorted(relevant_open_items), ensure_ascii=False),
        )

    checks = checks_by_id(data)
    guarded_items = RELEASE_GATE_OPEN_ITEM_GUARD_CHECKS.get(gate, {})
    for item, guarded_check_ids in guarded_items.items():
        if item not in unchecked_lines:
            continue
        for check_id in guarded_check_ids:
            require(check_id in checks, f"{gate} open-item guard references unknown check {check_id}")
            require(
                checks[check_id]["status"] != "pass",
                f"{gate}.{check_id} cannot pass while checklist item remains open: {item}",
            )


def validate_runtime_gate_evidence_refs(
    gate: str,
    data: dict[str, Any],
    unchecked_lines: set[str],
) -> None:
    checks = checks_by_id(data)
    runtime_check_ids = RUNTIME_GATE_CHECK_IDS.get(gate, set())
    if not runtime_check_ids:
        return

    for check_id in runtime_check_ids:
        require(check_id in checks, f"{gate} runtime gate guard references unknown check {check_id}")
        check = checks[check_id]
        evidence_ref = check["evidence_ref"]
        if check["status"] in {"blocked", "fail"}:
            requirement = RUNTIME_BLOCKED_EVIDENCE_REQUIREMENTS.get((gate, check_id))
            require(
                requirement is not None,
                f"{gate}.{check_id} has no gate-specific blocked runtime evidence requirement",
            )
            evidence_ref_lower = evidence_ref.lower()
            missing_tokens = [
                token
                for token in requirement["tokens"]
                if token not in evidence_ref_lower
            ]
            require(
                not missing_tokens,
                f"{gate}.{check_id} blocked evidence missing runtime blocker tokens: {missing_tokens}",
            )
            require(
                any(re.search(pattern, evidence_ref) for pattern in requirement["path_patterns"]),
                f"{gate}.{check_id} blocked evidence must cite the missing gate-specific runtime/deployment evidence area: "
                + json.dumps(requirement["path_patterns"]),
            )
            require_split_runtime_blocked_evidence(evidence_ref, gate, check_id)
        if check["status"] == "pass":
            require(
                RUNTIME_EVIDENCE_RE.search(evidence_ref) is not None,
                f"{gate}.{check_id} pass evidence must cite runtime/deployment evidence, not only fixture prose",
            )
            require(
                DEFINITION_ONLY_EVIDENCE_RE.fullmatch(evidence_ref.strip()) is None,
                f"{gate}.{check_id} pass evidence cannot be a definition-only artifact",
            )
            requirement = RUNTIME_PASS_REQUIREMENTS.get((gate, check_id))
            require(
                requirement is not None,
                f"{gate}.{check_id} has no gate-specific runtime pass requirement",
            )
            evidence_ref_lower = evidence_ref.lower()
            missing_tokens = [
                token
                for token in requirement["tokens"]
                if token not in evidence_ref_lower
            ]
            require(
                not missing_tokens,
                f"{gate}.{check_id} pass evidence missing runtime tokens: {missing_tokens}",
            )
            require(
                any(re.search(pattern, evidence_ref) for pattern in requirement["path_patterns"]),
                f"{gate}.{check_id} pass evidence must cite gate-specific runtime/deployment evidence paths: "
                + json.dumps(requirement["path_patterns"]),
            )
            require_runtime_file_evidence(evidence_ref, gate, check_id)
            evidence_files = RUNTIME_PASS_EVIDENCE_FILES.get((gate, check_id))
            if evidence_files is not None:
                require_evidence_ref_cites_files(
                    evidence_ref,
                    evidence_files,
                    f"{gate}.{check_id} pass evidence",
                )
                require_split_runtime_pass_evidence(evidence_ref, gate, check_id)
            if (gate, check_id) == ("private_beta_staging", "staging_observability_backup_load"):
                require_staging_observability_backup_load_pass_evidence(evidence_ref)
            if (gate, check_id) == ("ci", "ci_installed_workflow"):
                require(
                    CI_WORKFLOW_REL in evidence_ref,
                    f"{gate}.{check_id} pass evidence must cite exact installed workflow path {CI_WORKFLOW_REL}",
                )
                require(
                    CI_WORKFLOW.exists(),
                    f"{gate}.{check_id} cannot pass until {CI_WORKFLOW_REL} exists",
                )
                installed_workflow = CI_WORKFLOW.read_text(encoding="utf-8")
                draft_workflow = CI_DRAFT.read_text(encoding="utf-8")
                for token in [
                    "stage0-rev2",
                    "playwright",
                    "docker",
                    "validate_stage0_rev2.py",
                ]:
                    require(
                        token in installed_workflow.lower(),
                        f"{gate}.{check_id} installed workflow missing required Stage 0 CI token: {token}",
                    )
                    require(
                        token in draft_workflow.lower(),
                        f"{gate}.{check_id} CI draft missing required Stage 0 CI token: {token}",
                    )
            if (gate, check_id) == ("local_alpha", "local_alpha_e2e_workflow_smoke"):
                evidence_ref_lower = evidence_ref.lower()
                for workflow_id, aliases in LOCAL_ALPHA_E2E_WORKFLOW_EVIDENCE_REQUIREMENTS.items():
                    require(
                        any(alias.lower() in evidence_ref_lower for alias in aliases),
                        f"{gate}.{check_id} pass evidence must name workflow runtime coverage for {workflow_id}",
                    )
                    for evidence_kind, path in LOCAL_ALPHA_WORKFLOW_RUNTIME_EVIDENCE_FILES[workflow_id].items():
                        require(
                            rel(path) in evidence_ref,
                            f"{gate}.{check_id} pass evidence must cite exact {workflow_id} {evidence_kind} runtime artifact: {rel(path)}",
                        )
                for token in ["api", "playwright", "export zip"]:
                    require(
                        evidence_ref_lower.count(token) >= len(LOCAL_ALPHA_E2E_WORKFLOW_EVIDENCE_REQUIREMENTS),
                        f"{gate}.{check_id} pass evidence must cite per-workflow {token!r} evidence for all four workflows",
                    )
                require_local_alpha_workflow_runtime_files(
                    evidence_ref,
                    f"{gate}.{check_id} pass evidence",
                )

    runtime_items_open = RELEASE_GATE_RUNTIME_OPEN_ITEMS & unchecked_lines
    if gate == "local_alpha":
        relevant_runtime_open = {
            "Local Alpha workflow API/Playwright end-to-end smoke evidence 通过并写入 release gate fixture。"
        } & runtime_items_open
    elif gate == "ci":
        relevant_runtime_open = {
            "CI installed workflow runtime evidence 通过：PR/main run、Playwright smoke、Docker image build 均有 validator-resolvable evidence。"
        } & runtime_items_open
        relevant_runtime_open |= set(CI_RUNTIME_OPEN_CHECK_ITEMS) & unchecked_lines
    elif gate == "private_beta_staging":
        relevant_runtime_open = {
            "Private Beta/Staging external-user runtime evidence 通过：auth/RBAC/tenant、storage、quota/rate limit、support/abuse、safety/QA/crawler、observability/backup/load、legal visibility 均有 staging evidence。"
        } & runtime_items_open
        relevant_runtime_open |= set(PRIVATE_BETA_STAGING_RUNTIME_OPEN_CHECK_ITEMS) & unchecked_lines
    elif gate == "production_launch":
        relevant_runtime_open = {
            "Production Launch runtime/deployment evidence 通过：provider-or-comp-only、paid lifecycle、skill canary、activation audit、abuse hold、security、backup/rollback/post-deploy smoke、legal/support policy 均有 production evidence。"
        } & runtime_items_open
        relevant_runtime_open |= set(PRODUCTION_RUNTIME_OPEN_CHECK_ITEMS) & unchecked_lines
    else:
        relevant_runtime_open = set()

    if relevant_runtime_open:
        aggregate_runtime_open_items = {
            LOCAL_ALPHA_AGGREGATE_RUNTIME_ITEM,
            PRIVATE_BETA_STAGING_AGGREGATE_RUNTIME_ITEM,
            PRODUCTION_AGGREGATE_RUNTIME_ITEM,
        }
        concrete_runtime_open = relevant_runtime_open - aggregate_runtime_open_items
        check_level_guard_map = (
            LOCAL_ALPHA_RELEASE_GATE_WORKFLOW_RUNTIME_OPEN_CHECK_ITEMS
            if gate == "local_alpha"
            else CI_RUNTIME_OPEN_CHECK_ITEMS
            if gate == "ci"
            else
            PRIVATE_BETA_STAGING_RUNTIME_OPEN_CHECK_ITEMS
            if gate == "private_beta_staging"
            else PRODUCTION_RUNTIME_OPEN_CHECK_ITEMS
            if gate == "production_launch"
            else {}
        )
        for check_id in runtime_check_ids:
            specific_open_items = [
                item
                for item in concrete_runtime_open
                if check_id in check_level_guard_map.get(item, runtime_check_ids)
            ]
            if not specific_open_items:
                continue
            require(
                checks[check_id]["status"] != "pass",
                f"{gate}.{check_id} cannot pass while runtime evidence checklist item remains open: "
                + json.dumps(sorted(specific_open_items), ensure_ascii=False),
            )


def validate_aggregate_runtime_checklist_items(
    gate: str,
    data: dict[str, Any],
    checked_lines: set[str],
    unchecked_lines: set[str],
) -> None:
    for aggregate_item, required_subitems in RELEASE_GATE_AGGREGATE_REQUIREMENTS.get(gate, {}).items():
        require(
            aggregate_item in checked_lines or aggregate_item in unchecked_lines,
            f"{gate} aggregate runtime checklist item is missing: {aggregate_item}",
        )
        missing_subitems = required_subitems - checked_lines
        decision_status = gate_decision_status(data)
        gate_ready = gate_allows_checklist_completion(data)
        if aggregate_item in checked_lines:
            require(
                not missing_subitems,
                f"{gate} aggregate runtime item is closed before all concrete evidence subitems are closed: "
                + json.dumps(sorted(missing_subitems), ensure_ascii=False),
            )
            require(
                gate_ready,
                f"{gate} aggregate runtime item is closed but release gate evidence still has blockers: "
                + json.dumps(gate_blockers(data), ensure_ascii=False, sort_keys=True),
            )
            require(
                decision_status == "go",
                f"{gate} aggregate runtime item is closed but gate_decision.status is {decision_status!r}",
            )
        else:
            require(
                missing_subitems or not gate_ready,
                f"{gate} aggregate runtime item remains open after concrete subitems and gate evidence allow closure",
            )


def validate_release_gate_order_dependencies(evidence: dict[str, dict[str, Any]]) -> None:
    ci = evidence["ci"]
    private_beta = evidence["private_beta_staging"]
    production = evidence["production_launch"]

    ci_ready = gate_allows_checklist_completion(ci)
    private_beta_ready = gate_allows_checklist_completion(private_beta)
    upstream_ready = ci_ready and private_beta_ready

    production_checks = checks_by_id(production)
    production_conditions = do_not_launch_by_id(production)
    dependency_condition = production_conditions["ci_staging_gates_not_passed"]
    dependency_check = production_checks["production_backup_rollback_incident"]
    require(
        dependency_condition["is_present"] is (not upstream_ready),
        "production ci_staging_gates_not_passed condition must reflect computed CI and Private Beta/Staging readiness",
    )
    if dependency_check["status"] == "pass":
        require(
            upstream_ready,
            "production backup/rollback/post-deploy check cannot pass unless CI and Private Beta/Staging gates are computed ready",
        )
        require(
            "fixtures/stage0/rev2/release_gate_evidence.ci.json" in dependency_check["evidence_ref"]
            and "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json"
            in dependency_check["evidence_ref"],
            "production backup/rollback/post-deploy pass evidence must cite both upstream gate fixtures",
        )
    if upstream_ready:
        return

    require(
        dependency_check["status"] != "pass",
        "production backup/rollback/post-deploy check cannot pass while CI or Private Beta/Staging gates remain blocked",
    )
    require(
        not gate_allows_checklist_completion(production),
        "production gate cannot allow checklist completion while CI or Private Beta/Staging gates remain blocked",
    )
    evidence_ref = dependency_condition["evidence_ref"]
    for path in [
        "fixtures/stage0/rev2/release_gate_evidence.ci.json",
        "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    ]:
        require(
            path in evidence_ref,
            "production CI/staging dependency condition must cite both upstream release gate fixtures",
        )


def active_do_not_launch_conditions_by_gate(evidence: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    return {
        gate: sorted(
            item["condition_id"]
            for item in data["do_not_launch_checks"]
            if item["is_present"]
        )
        for gate, data in evidence.items()
    }


def validate_global_do_not_launch_checklist_item(
    evidence: dict[str, dict[str, Any]],
    checked_lines: set[str],
    unchecked_lines: set[str],
) -> None:
    global_state_count = int(GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM in checked_lines) + int(
        GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM in unchecked_lines
    )
    require(
        global_state_count == 1,
        f"blueprint missing global launch checklist item: {GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM}",
    )
    active_conditions = {
        gate: conditions
        for gate, conditions in active_do_not_launch_conditions_by_gate(evidence).items()
        if conditions
    }
    open_gate_items = sorted(item for item in GATE_CHECKLIST_ITEMS if item in unchecked_lines)
    non_go_decisions = {
        gate: gate_decision_status(data)
        for gate, data in evidence.items()
        if gate_decision_status(data) != "go"
    }

    if GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM in checked_lines:
        require(
            not active_conditions,
            "blueprint marks Do-Not-Launch Conditions complete while active release blockers remain: "
            + json.dumps(active_conditions, ensure_ascii=False, sort_keys=True),
        )
        require(
            not open_gate_items,
            "blueprint marks Do-Not-Launch Conditions complete while release gate checklist items remain open: "
            + json.dumps(open_gate_items, ensure_ascii=False),
        )
        require(
            not non_go_decisions,
            "blueprint marks Do-Not-Launch Conditions complete while release gate decisions remain no-go: "
            + json.dumps(non_go_decisions, ensure_ascii=False, sort_keys=True),
        )
        return

    require(
        active_conditions or open_gate_items or non_go_decisions,
        "global Do-Not-Launch checklist item remains open even though release-gate fixtures have no active "
        "Do-Not-Launch conditions, all release gate checklist items are closed, and every gate_decision is go",
    )


def validate_release_gate_checklist_decision_alignment(
    evidence: dict[str, dict[str, Any]],
    checked_lines: set[str],
    unchecked_lines: set[str],
) -> None:
    for item, gate in GATE_CHECKLIST_ITEMS.items():
        gate_item_state_count = int(item in checked_lines) + int(item in unchecked_lines)
        require(
            gate_item_state_count == 1,
            f"blueprint missing launch gate checklist item: {item}",
        )
        require(gate in evidence, f"missing release gate evidence for {gate}")
        decision_status = evidence[gate]["gate_decision"]["status"]
        aggregate_item = RELEASE_GATE_AGGREGATE_ITEMS[gate]
        aggregate_subitems = RELEASE_GATE_AGGREGATE_GUARD_ITEMS[gate]
        aggregate_missing_subitems = sorted(aggregate_subitems - checked_lines)
        aggregate_state_count = int(aggregate_item in checked_lines) + int(aggregate_item in unchecked_lines)
        require(
            aggregate_state_count == 1,
            f"{gate} aggregate runtime checklist item is missing: {aggregate_item}",
        )
        if item in checked_lines:
            require(
                decision_status == "go",
                f"blueprint marks {item!r} complete but {gate} gate_decision.status is {decision_status!r}",
            )
            require(
                gate_allows_checklist_completion(evidence[gate]),
                f"blueprint marks {item!r} complete but {gate} release gate evidence still has blockers: "
                + json.dumps(gate_blockers(evidence[gate]), ensure_ascii=False, sort_keys=True),
            )
            require(
                aggregate_item in checked_lines,
                f"blueprint marks {item!r} complete before aggregate runtime checklist item is closed: {aggregate_item}",
            )
            require(
                not aggregate_missing_subitems,
                f"blueprint marks {item!r} complete before concrete aggregate runtime subitems are closed: "
                + json.dumps(aggregate_missing_subitems, ensure_ascii=False),
            )
        else:
            require(
                decision_status == "no_go",
                f"{gate} gate_decision.status cannot be {decision_status!r} while blueprint gate item remains open: {item}",
            )
            require(
                aggregate_item in unchecked_lines
                or aggregate_missing_subitems
                or not gate_allows_checklist_completion(evidence[gate]),
                f"{gate} gate item remains open even though aggregate runtime checklist and gate evidence allow closure",
            )

    global_state_count = int(GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM in checked_lines) + int(
        GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM in unchecked_lines
    )
    require(
        global_state_count == 1,
        f"blueprint missing global launch checklist item: {GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM}",
    )
    gate_decisions = {
        gate: data["gate_decision"]["status"]
        for gate, data in evidence.items()
    }
    if GLOBAL_DO_NOT_LAUNCH_CHECKLIST_ITEM in checked_lines:
        non_go_gates = {
            gate: status
            for gate, status in gate_decisions.items()
            if status != "go"
        }
        require(
            not non_go_gates,
            "global Do-Not-Launch checklist item cannot close while release gate decisions are not go: "
            + json.dumps(non_go_gates, ensure_ascii=False, sort_keys=True),
        )
    else:
        require(
            any(status != "go" for status in gate_decisions.values())
            or any(item in unchecked_lines for item in GATE_CHECKLIST_ITEMS),
            "global Do-Not-Launch checklist item remains open even though all release gate decisions are go",
        )


def checked_items(text: str) -> set[str]:
    return {
        match.group(1)
        for match in re.finditer(r"^- \[x\] (.+)$", text, flags=re.MULTILINE)
    }


def unchecked_items(text: str) -> set[str]:
    return {
        match.group(1)
        for match in re.finditer(r"^- \[ \] (.+)$", text, flags=re.MULTILINE)
    }


def blueprint_do_not_launch_conditions() -> set[str]:
    text = BLUEPRINT.read_text(encoding="utf-8")
    match = re.search(r"^## 24\. Do-Not-Launch Conditions\n(?P<body>.*?)(?=^## 25\.)", text, flags=re.MULTILINE | re.DOTALL)
    require(match is not None, "blueprint missing section 24 Do-Not-Launch Conditions")
    return {
        item.strip()
        for item in re.findall(r"^- (.+)$", match.group("body"), flags=re.MULTILINE)
    }


def validate_schema_value(schema: dict[str, Any], value: Any, path: str, root_schema: dict[str, Any]) -> None:
    seen_refs: set[str] = set()
    while "$ref" in schema:
        ref = schema["$ref"]
        require(ref.startswith("#/$defs/"), f"{path} uses unsupported schema ref {ref}")
        require(ref not in seen_refs, f"{path} has recursive schema ref {ref}")
        seen_refs.add(ref)
        def_name = ref.removeprefix("#/$defs/")
        try:
            resolved = root_schema["$defs"][def_name]
        except KeyError:
            fail(f"{path} references missing schema def {def_name}")
        siblings = {key: child for key, child in schema.items() if key != "$ref"}
        schema = {**resolved, **siblings}
        if "properties" in resolved or "properties" in siblings:
            schema["properties"] = {
                **resolved.get("properties", {}),
                **siblings.get("properties", {}),
            }
        if "required" in resolved or "required" in siblings:
            schema["required"] = sorted(set(resolved.get("required", [])) | set(siblings.get("required", [])))

    for index, child in enumerate(schema.get("allOf", [])):
        validate_schema_value(child, value, f"{path}.allOf[{index}]", root_schema)

    if "oneOf" in schema:
        matches = 0
        errors: list[str] = []
        for index, child in enumerate(schema["oneOf"]):
            try:
                validate_schema_value(child, value, f"{path}.oneOf[{index}]", root_schema)
            except ValidationError as exc:
                errors.append(str(exc))
            else:
                matches += 1
        require(matches == 1, f"{path} must match exactly one oneOf schema; matched {matches}; errors: {errors[:3]}")

    if "if" in schema:
        try:
            validate_schema_value(schema["if"], value, f"{path}.if", root_schema)
        except ValidationError:
            if "else" in schema:
                validate_schema_value(schema["else"], value, f"{path}.else", root_schema)
        else:
            if "then" in schema:
                validate_schema_value(schema["then"], value, f"{path}.then", root_schema)
    if "not" in schema:
        try:
            validate_schema_value(schema["not"], value, f"{path}.not", root_schema)
        except ValidationError:
            pass
        else:
            require(False, f"{path} must not match forbidden schema")

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
        dependent_required = schema.get("dependentRequired", {})
        for key, dependents in dependent_required.items():
            if key in value:
                missing_dependents = set(dependents) - set(value)
                require(
                    not missing_dependents,
                    f"{path}.{key} requires sibling keys: {sorted(missing_dependents)}",
                )
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
        if schema.get("format") == "date-time":
            require(
                re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$", value)
                is not None,
                f"{path} must be an RFC3339 date-time with timezone",
            )
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                fail(f"{path} must be a valid RFC3339 date-time")
            require(parsed.tzinfo is not None, f"{path} must include timezone information")
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
        SCHEMA_DIR / "eval_result.schema.json",
        SCHEMA_DIR / "eval_storage_contract.schema.json",
        SCHEMA_DIR / "workflow_api_smoke_evidence.schema.json",
        SCHEMA_DIR / "workflow_runtime_evidence_contract.schema.json",
        SCHEMA_DIR / "activation_gate_contract.schema.json",
        SCHEMA_DIR / "qa_result.schema.json",
        SCHEMA_DIR / "safety_rule.schema.json",
        SCHEMA_DIR / "workflow_acceptance.schema.json",
        SCHEMA_DIR / "crawler_governance.schema.json",
        SCHEMA_DIR / "feedback_event.schema.json",
        SCHEMA_DIR / "abuse_event.schema.json",
        SCHEMA_DIR / "analytics_taxonomy.schema.json",
        SCHEMA_DIR / "trace_completeness.schema.json",
        SCHEMA_DIR / "trace_export_gate_matrix.schema.json",
        SCHEMA_DIR / "safety_enforcement_contract.schema.json",
        SCHEMA_DIR / "qa_result_coverage.schema.json",
        SCHEMA_DIR / "qa_enforcement_matrix.schema.json",
        SCHEMA_DIR / "release_gate_evidence.schema.json",
        FIXTURE_DIR / "eval" / "starter_eval_suite.json",
        FIXTURE_DIR / "eval" / "starter_eval_results.json",
        FIXTURE_DIR / "eval" / "eval_storage_contract.json",
        FIXTURE_DIR / "eval" / "workflow_api_smoke_evidence.json",
        FIXTURE_DIR / "eval" / "workflow_runtime_evidence_contract.json",
        FIXTURE_DIR / "eval" / "activation_gate_contract.json",
        FIXTURE_DIR / "eval" / "trace_completeness.json",
        FIXTURE_DIR / "eval" / "trace_export_gate_matrix.json",
        FIXTURE_DIR / "eval" / "safety_enforcement_contract.json",
        FIXTURE_DIR / "eval" / "qa_result_coverage.json",
        FIXTURE_DIR / "eval" / "qa_enforcement_matrix.json",
        FIXTURE_DIR / "eval" / "qa_results.json",
        FIXTURE_DIR / "eval" / "safety_rules.json",
        FIXTURE_DIR / "crawler" / "crawler_governance_cases.json",
        FIXTURE_DIR / "feedback" / "feedback_events.json",
        FIXTURE_DIR / "abuse" / "abuse_events.json",
        FIXTURE_DIR / "analytics" / "event_taxonomy.json",
        FIXTURE_DIR / "release_gate_evidence.local_alpha.json",
        FIXTURE_DIR / "release_gate_evidence.ci.json",
        FIXTURE_DIR / "release_gate_evidence.private_beta_staging.json",
        FIXTURE_DIR / "release_gate_evidence.production_launch.json",
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
                    value["created_by_lane"] in {"lane2", "lane6"},
                    f"{path.relative_to(ROOT)} has unsupported lane provenance",
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
        evidence["draft_ref"] == CI_DRAFT_REL,
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
    required_artifacts = {
        "ops_ci_draft",
        "migration_artifacts",
        "openapi_artifacts",
        "playwright_smoke_draft",
        "docker_and_staging_smoke_draft",
    }
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


def validate_workflow_acceptance_split_contracts() -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked_lines = checked_items(text)
    unchecked_lines = unchecked_items(text)
    local_alpha = load_json(FIXTURE_DIR / "release_gate_evidence.local_alpha.json")
    local_alpha_checks = checks_by_id(local_alpha)
    local_alpha_smoke = local_alpha_checks["local_alpha_e2e_workflow_smoke"]

    for workflow_id, split in WORKFLOW_ACCEPTANCE_SPLITS.items():
        fixture_path = FIXTURE_DIR / "workflows" / f"{workflow_id}.json"
        require(fixture_path.exists(), f"workflow acceptance fixture missing: {fixture_path.relative_to(ROOT)}")
        data = load_json(fixture_path)
        require(data["workflow_id"] == workflow_id, f"{fixture_path.relative_to(ROOT)} workflow_id mismatch")
        require(split["fixture_item"] in checked_lines, f"blueprint must close fixture evidence item: {split['fixture_item']}")
        require(
            split["ambiguous_item"] not in checked_lines and split["ambiguous_item"] not in unchecked_lines,
            f"ambiguous workflow acceptance checklist item must stay split: {split['ambiguous_item']}",
        )
        require(data["required_inputs"], f"{workflow_id} fixture must define required inputs")
        require(data["clarification_questions"], f"{workflow_id} fixture must define clarification questions")
        require(len(data["four_option_taxonomy"]) == 4, f"{workflow_id} fixture must define four taxonomy options")
        require(data["required_package_outputs"], f"{workflow_id} fixture must define required package outputs")
        require(data["golden_fixture"]["expected_candidate_count"] == 4, f"{workflow_id} golden fixture must expect four candidates")
        require(
            "manifest.json" in data["golden_fixture"]["expected_export_files"],
            f"{workflow_id} golden fixture must require manifest export evidence",
        )
        require(
            "qa_report.json" in data["golden_fixture"]["expected_export_files"],
            f"{workflow_id} golden fixture must require QA report export evidence",
        )
        require(
            "trace_provenance.json" in data["golden_fixture"]["expected_export_files"],
            f"{workflow_id} golden fixture must require trace provenance export evidence",
        )
        for item_key, requirement in WORKFLOW_RUNTIME_EVIDENCE_REQUIREMENTS.items():
            checklist_item = split[item_key]
            contract_key = requirement["contract_key"]
            contract = data[contract_key] if contract_key is not None else None
            if checklist_item in unchecked_lines:
                if contract is not None:
                    require(
                        contract["execution_status"] == "not_executed",
                        f"{workflow_id} {requirement['status_label']} contract must not claim runtime execution while checklist item is open",
                    )
                else:
                    evidence_kind = item_key.removesuffix("_item")
                    evidence_path = LOCAL_ALPHA_WORKFLOW_RUNTIME_EVIDENCE_FILES[workflow_id][evidence_kind]
                    require(
                        not evidence_path.exists(),
                        f"{workflow_id} {requirement['status_label']} checklist item is open but exact evidence exists: {rel(evidence_path)}",
                    )
                continue

            require(
                checklist_item in checked_lines,
                f"blueprint missing workflow runtime checklist item: {checklist_item}",
            )
            if item_key in WORKFLOW_RUNTIME_CLOSED_ITEMS.get(workflow_id, set()):
                expected_kind = item_key.removesuffix("_item")
                expected_path = LOCAL_ALPHA_WORKFLOW_RUNTIME_EVIDENCE_FILES[workflow_id][expected_kind]
                require_local_alpha_single_workflow_runtime_files(
                    local_alpha_smoke["evidence_ref"],
                    workflow_id,
                    f"{workflow_id} {requirement['status_label']} runtime closure",
                    {expected_kind},
                )
                require(
                    rel(expected_path) in local_alpha_smoke["evidence_ref"],
                    f"{workflow_id} {requirement['status_label']} closure must cite exact runtime evidence file",
                )
            else:
                require(
                    contract is not None,
                    f"{workflow_id} {requirement['status_label']} closure requires exact evidence file validation",
                )
                require(
                    contract["execution_status"] == requirement["required_status"],
                    f"{workflow_id} {requirement['status_label']} checklist item is closed but fixture contract is not executed",
                )
                require(
                    contract["blueprint_checklist_remains_open"] is False,
                    f"{workflow_id} {requirement['status_label']} executed contract must allow checklist closure",
                )
                require(
                    local_alpha_smoke["status"] == "pass",
                    f"{workflow_id} {requirement['status_label']} cannot close until local_alpha_e2e_workflow_smoke passes",
                )
                evidence_ref = local_alpha_smoke["evidence_ref"].lower()
                missing_terms = [
                    term
                    for term in requirement["required_evidence_terms"]
                    if term not in evidence_ref
                ]
                require(
                    not missing_terms,
                    f"{workflow_id} {requirement['status_label']} closure missing Local Alpha evidence terms: {missing_terms}",
                )
                require(
                    rel(LOCAL_ALPHA_WORKFLOW_RUNTIME_EVIDENCE_FILES[workflow_id][item_key.split("_")[0]])
                    in local_alpha_smoke["evidence_ref"],
                    f"{workflow_id} {requirement['status_label']} closure must cite exact runtime evidence file",
                )
                require_local_alpha_workflow_runtime_files(
                    local_alpha_smoke["evidence_ref"],
                    f"{workflow_id} {requirement['status_label']} Local Alpha aggregate evidence",
                )


    workflow_contract = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_workflow_acceptance_contract.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        workflow_contract.returncode == 0,
        "workflow acceptance contract validation failed: "
        + (workflow_contract.stderr or workflow_contract.stdout).strip(),
    )

    api_smoke_evidence = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_workflow_api_smoke_evidence.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        api_smoke_evidence.returncode == 0,
        "workflow API smoke evidence validation failed: "
        + (api_smoke_evidence.stderr or api_smoke_evidence.stdout).strip(),
    )

    workflow_runtime_contract = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_workflow_runtime_evidence_contract.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        workflow_runtime_contract.returncode == 0,
        "workflow runtime evidence contract validation failed: "
        + (workflow_runtime_contract.stderr or workflow_runtime_contract.stdout).strip(),
    )


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


def validate_eval_results() -> None:
    results = load_json(FIXTURE_DIR / "eval" / "starter_eval_results.json")
    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    result = results[0]
    suite = load_json(FIXTURE_DIR / "eval" / "starter_eval_suite.json")
    qa_results = load_json(FIXTURE_DIR / "eval" / "qa_results.json")
    safety_rules = load_json(FIXTURE_DIR / "eval" / "safety_rules.json")

    require(result["suite_id"] == suite["suite_id"], "eval result must reference starter eval suite")
    require(result["completed_at"], "eval result must persist completed_at")
    require(result["created_at"], "eval result must persist created_at")
    require(result["storage_contract"]["table"] == "eval_results", "eval result must declare eval_results storage")
    require(
        {"tenant_id", "eval_suite_id", "subject_type", "subject_id", "status", "summary", "completed_at", "created_at"}
        <= set(result["storage_contract"]["required_columns"]),
        "eval result storage contract missing required persisted columns",
    )
    require(
        {"tenant_id", "eval_suite_id", "subject_type", "subject_id", "status", "completed_after", "latest_only"}
        <= set(result["storage_contract"]["required_query_filters"]),
        "eval result storage contract missing required read filters",
    )
    require(result["storage_contract"]["immutable_rows"] is True, "eval result storage contract must preserve immutable rows")
    require(
        set(result["storage_contract"]["summary_projection_fields"]) == SUMMARY_PROJECTION_FIELDS,
        "eval result storage summary projection fields mismatch",
    )
    require(
        set(result["storage_contract"]["fixture_result_projection_fields"]) == FIXTURE_RESULT_PROJECTION_FIELDS,
        "eval result storage fixture projection fields mismatch",
    )
    require(
        result["storage_contract"]["admin_read_projection_required"] is True,
        "eval result storage must require admin read projections",
    )
    require(
        result["storage_contract"]["read_without_eval_rerun"] is True,
        "eval result storage reads must not require eval rerun",
    )
    require(
        result["storage_contract"]["no_public_delete_operation"] is True,
        "eval result storage contract must not expose public delete",
    )
    require(
        set(result["storage_contract"]["idempotent_replay_key"])
        == {"tenant_id", "eval_suite_id", "subject_type", "subject_id", "subject_version", "runner_sha256"},
        "eval result storage idempotent replay key mismatch",
    )
    retention = result["storage_contract"]["retention_contract"]
    for field in [
        "retain_pass_fail_blocked_results",
        "retain_summary_json",
        "retain_runner_hash",
        "deletion_requires_admin_audit",
        "redaction_requires_admin_audit",
        "no_public_delete_operation",
    ]:
        require(retention[field] is True, f"eval result storage retention contract must set {field}")
    require(retention["minimum_retention_days"] >= 365, "eval result retention must be at least 365 days")

    fixture_ids = {fixture["fixture_id"] for fixture in suite["fixtures"]}
    result_by_fixture = {item["fixture_id"]: item for item in result["fixture_results"]}
    require(set(result_by_fixture) == fixture_ids, "eval result must include one fixture result per suite fixture")

    qa_by_id = {item["check_id"]: item for item in qa_results}
    safety_by_fixture: dict[str, list[dict[str, Any]]] = {}
    for rule in safety_rules:
        for fixture_id in rule["eval_fixture_links"]:
            safety_by_fixture.setdefault(fixture_id, []).append(rule)
    qa_categories = {item["check_category"] for item in qa_results}
    require(
        QA_CATEGORIES <= set(result["summary"]["qa_categories_covered"]),
        "eval result summary must cover every required QA category",
    )
    require(
        set(result["summary"]["qa_categories_covered"]) == qa_categories,
        "eval result QA category summary must match QA fixtures",
    )
    require(
        set(result["summary"]["safety_enforcement_points_covered"]) == SAFETY_POINTS,
        "eval result summary must cover every safety enforcement point",
    )
    require(result["summary"]["trace_complete"] is True, "eval result must prove trace completeness")
    expected_summary_export_complete = all(
        item["export_contract"]["blocks_when_incomplete"] is True
        and item["qa_export_gate"]["export_artifacts_complete"] is all(
            item["export_contract"][key]
            for key in [
                "manifest",
                "qa_report",
                "metadata",
                "trace_provenance",
                "safety_disclaimer_when_applicable",
            ]
        )
        for item in result["fixture_results"]
    )
    require(
        result["summary"]["export_contract_complete"] is expected_summary_export_complete,
        "eval result export contract completeness summary must match fixture gates",
    )
    require(result["summary"]["export_contract_complete"] is True, "eval result must prove export contract completeness")
    require(
        result["summary"]["qa_fixture_coverage_complete"]
        is all(item["qa_coverage_contract"]["coverage_complete"] for item in result["fixture_results"]),
        "eval result QA fixture coverage summary must match fixture results",
    )
    require(result["summary"]["critical_safety_regressions"] == 0, "eval result must have no critical safety regressions")
    if result["summary"]["golden_passed"] is False:
        require(
            result["status"] in {"blocked", "fail"},
            "eval result with incomplete golden coverage cannot report pass status",
        )

    for fixture in suite["fixtures"]:
        item = result_by_fixture[fixture["fixture_id"]]
        require(item["workflow"] == fixture["workflow"], f"{item['fixture_id']} workflow mismatch")
        require(item["category"] == fixture["category"], f"{item['fixture_id']} category mismatch")
        require(
            item["candidate_count"] >= fixture["expected_evidence"]["minimum_candidates"],
            f"{item['fixture_id']} candidate count below expected minimum",
        )
        require(
            item["expected_safety_action"] == fixture["expected_evidence"]["expected_safety_action"],
            f"{item['fixture_id']} expected safety action mismatch",
        )
        validate_eval_safety_decision_contract(item, safety_by_fixture.get(item["fixture_id"], []))
        trace = item["trace_contract"]
        require(trace["trace_id"].startswith("trace_"), f"{item['fixture_id']} trace_id must be trace-scoped")
        for key in [
            "has_schema_validation",
            "has_provenance",
            "has_safety_status",
            "has_qa_eval_status",
            "has_quota_transaction",
            "has_admin_visibility",
            "has_user_failure_mapping",
        ]:
            require(trace[key] is True, f"{item['fixture_id']} trace contract missing {key}")
        if fixture["expected_evidence"]["must_include_trace_provenance"]:
            require(item["export_contract"]["trace_provenance"] is True, f"{item['fixture_id']} export must include trace provenance")
        if fixture["expected_evidence"]["must_include_qa_report"]:
            require(item["export_contract"]["qa_report"] is True, f"{item['fixture_id']} export must include QA report")
        workflow = load_json(FIXTURE_DIR / "workflows" / f"{item['workflow']}.json")
        dimension_qa_categories = {
            category
            for dimension in fixture["expected_dimensions"]
            for category in DIMENSION_QA_CATEGORIES.get(dimension, set())
        }
        workflow_required_qa_categories = [
            category
            for category in QA_CATEGORY_ORDER
            if category in set(workflow["required_qa_checks"])
        ]
        expected_qa_categories = [
            category
            for category in QA_CATEGORY_ORDER
            if category in dimension_qa_categories or category in set(workflow_required_qa_categories)
        ]
        observed_qa_categories = sorted(
            {
                qa_by_id[check_id]["check_category"]
                for check_id in item["qa_check_ids"]
            },
            key=QA_CATEGORY_ORDER.index,
        )
        missing_qa_categories = [
            category
            for category in expected_qa_categories
            if category not in observed_qa_categories
        ]
        coverage = item["qa_coverage_contract"]
        require(
            coverage["expected_qa_categories"] == expected_qa_categories,
            f"{item['fixture_id']} QA coverage expected categories mismatch",
        )
        require(
            coverage["observed_qa_categories"] == observed_qa_categories,
            f"{item['fixture_id']} QA coverage observed categories mismatch",
        )
        require(
            coverage["missing_qa_categories"] == missing_qa_categories,
            f"{item['fixture_id']} QA coverage missing categories mismatch",
        )
        require(
            coverage["coverage_complete"] is (not missing_qa_categories),
            f"{item['fixture_id']} QA coverage completeness mismatch",
        )
        qa_gate = item["qa_export_gate"]
        blocking_check_ids = [
            check_id
            for check_id in item["qa_check_ids"]
            if qa_by_id[check_id]["export_gate"]["blocks_final_export"] is True
        ]
        blocking_categories = sorted(
            {
                qa_by_id[check_id]["check_category"]
                for check_id in blocking_check_ids
            }
        )
        safety_blocks_export = item["observed_safety_action"] == "block"
        safety_holds_export = item["observed_safety_action"] in {"require_user_confirmation", "require_admin_review"}
        export_artifacts_complete = all(
            item["export_contract"][key]
            for key in [
                "manifest",
                "qa_report",
                "metadata",
                "trace_provenance",
                "safety_disclaimer_when_applicable",
            ]
        )
        expected_export_allowed = (
            export_artifacts_complete
            and coverage["coverage_complete"]
            and not blocking_check_ids
            and not safety_blocks_export
            and not safety_holds_export
        )
        require(
            qa_gate["blocking_qa_check_ids"] == blocking_check_ids,
            f"{item['fixture_id']} QA export gate blocking checks mismatch",
        )
        require(
            qa_gate["blocking_qa_categories"] == blocking_categories,
            f"{item['fixture_id']} QA export gate blocking categories mismatch",
        )
        require(
            qa_gate["safety_blocks_export"] is safety_blocks_export,
            f"{item['fixture_id']} QA export gate safety decision mismatch",
        )
        require(
            qa_gate["export_artifacts_complete"] is export_artifacts_complete,
            f"{item['fixture_id']} QA export gate artifact completeness mismatch",
        )
        require(
            qa_gate["final_export_allowed"] is expected_export_allowed,
            f"{item['fixture_id']} QA export gate final export decision mismatch",
        )
        require(qa_gate["override_requires_audit"] is True, f"{item['fixture_id']} QA export override must require audit")
        if item["status"] == "pass":
            require(
                coverage["coverage_complete"] is True,
                f"{item['fixture_id']} passed eval must have complete expected QA coverage",
            )
            require(qa_gate["final_export_allowed"] is True, f"{item['fixture_id']} passed eval must allow final export")
        else:
            require(qa_gate["final_export_allowed"] is False, f"{item['fixture_id']} blocked eval must deny final export")
        for check_id in item["qa_check_ids"]:
            require(check_id in qa_by_id, f"{item['fixture_id']} references unknown QA check {check_id}")
            require(
                qa_by_id[check_id]["evidence"]["fixture_id"] == item["fixture_id"],
                f"{item['fixture_id']} references QA check from another fixture",
            )
        if item["observed_safety_action"] == "block":
            require(
                item["status"] == "blocked" or item["failure_reasons"],
                f"{item['fixture_id']} safety block must block or include failure reason",
            )

    generated = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "run_stage0_eval.py"), "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        generated.returncode == 0,
        "stored eval results are stale: " + (generated.stderr or generated.stdout).strip(),
    )


def validate_eval_safety_decision_contract(item: dict[str, Any], linked_rules: list[dict[str, Any]]) -> None:
    fixture_id = item["fixture_id"]
    contract = item["safety_decision_contract"]
    rule_ids = [rule["rule_id"] for rule in linked_rules]
    expected_decision = (
        max((rule["action"] for rule in linked_rules), key=lambda action: SAFETY_ACTION_PRIORITY[action])
        if linked_rules
        else "allow"
    )
    expected_source = "linked_safety_rule" if linked_rules else "default_no_match"

    require(contract["decision"] == expected_decision, f"{fixture_id} safety decision must match linked rules")
    require(item["observed_safety_action"] == contract["decision"], f"{fixture_id} observed safety action must match decision contract")
    require(contract["decision_source"] == expected_source, f"{fixture_id} safety decision source mismatch")
    require(contract["source_rule_ids"] == rule_ids, f"{fixture_id} safety decision source rule mismatch")
    require(set(contract["enforcement_points"]) == SAFETY_POINTS, f"{fixture_id} safety decision must cover all safety points")
    require(contract["trace_status_required"] is True, f"{fixture_id} safety decision must require trace status")
    require(contract["persisted_decision_required"] is True, f"{fixture_id} safety decision must require persisted decisions")
    require(contract["audit_required"] is bool(linked_rules), f"{fixture_id} safety decision audit requirement mismatch")
    require(
        contract["export_gate_effect"] == SAFETY_EXPORT_GATE_EFFECT[contract["decision"]],
        f"{fixture_id} safety decision export gate effect mismatch",
    )


def validate_qa_and_safety() -> None:
    qa_results = load_json(FIXTURE_DIR / "eval" / "qa_results.json")
    eval_results = load_json(FIXTURE_DIR / "eval" / "starter_eval_results.json")
    severities = {item["severity"] for item in qa_results}
    require({"warning", "blocking"} <= severities, "QA fixtures must include warning and blocking examples")
    categories = {item["check_category"] for item in qa_results}
    require(categories == QA_CATEGORIES, f"QA fixtures category mismatch: {sorted(categories ^ QA_CATEGORIES)}")
    check_ids = [item["check_id"] for item in qa_results]
    require(len(check_ids) == len(set(check_ids)), "QA fixtures must have unique check_id values")
    fixture_ids = {
        fixture["fixture_id"]
        for fixture in load_json(FIXTURE_DIR / "eval" / "starter_eval_suite.json")["fixtures"]
    }
    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    eval_by_fixture = {item["fixture_id"]: item for item in eval_results[0]["fixture_results"]}
    require(
        set(eval_results[0]["summary"]["qa_categories_covered"]) == categories,
        "eval result QA category summary must exactly match QA result fixtures",
    )
    workflows = WORKFLOWS
    for item in qa_results:
        require(item["workflow"] in workflows, f"{item['check_id']} references unknown workflow")
        require(
            item["evidence"]["fixture_id"] in fixture_ids,
            f"{item['check_id']} references unknown eval fixture {item['evidence']['fixture_id']}",
        )
        require(
            item["evidence"]["fixture_id"] in eval_by_fixture,
            f"{item['check_id']} references fixture missing from eval results",
        )
        require(
            item["check_id"] in eval_by_fixture[item["evidence"]["fixture_id"]]["qa_check_ids"],
            f"{item['check_id']} is not linked from its eval result fixture",
        )
        coverage = eval_by_fixture[item["evidence"]["fixture_id"]]["qa_coverage_contract"]
        require(
            item["check_category"] in coverage["observed_qa_categories"],
            f"{item['check_id']} category must be represented in eval QA coverage contract",
        )
        require(
            eval_by_fixture[item["evidence"]["fixture_id"]]["trace_contract"]["trace_id"].startswith("trace_"),
            f"{item['check_id']} eval result trace contract must be trace-scoped",
        )
        require(item["evidence"]["trace_id"].startswith("trace_"), f"{item['check_id']} trace_id must be trace-scoped")
        require(
            item["evidence"]["trace_id"] == eval_by_fixture[item["evidence"]["fixture_id"]]["trace_contract"]["trace_id"],
            f"{item['check_id']} trace_id must match its eval result fixture trace",
        )
        require(item["evidence"]["observed"], f"{item['check_id']} must include observed QA evidence")
        require(item["evidence"]["expected"], f"{item['check_id']} must include expected QA evidence")
        require(item["evidence"]["source_artifacts"], f"{item['check_id']} must cite source artifacts")
        gate = item["export_gate"]
        if item["severity"] == "blocking":
            require(
                gate["blocks_final_export"] is True,
                f"{item['check_id']} blocking QA result must block final export",
            )
        require(
            gate["override_requires_audit"] is True,
            f"{item['check_id']} export override eligibility must require audit",
        )
    require(
        any(
            item["check_category"] == "text_readability"
            and item["evidence"]["observed"].get("manual_review_placeholder") is True
            for item in qa_results
        ),
        "QA fixtures must cover OCR/text readability with a manual-review placeholder",
    )
    require(
        any(
            item["check_category"] == "export_completeness"
            and item["evidence"]["observed"].get("manifest_json") is False
            and item["export_gate"]["blocks_final_export"] is True
            for item in qa_results
        ),
        "QA fixtures must include export completeness blocking missing manifest evidence",
    )
    qa_contract = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_qa_result_contract.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        qa_contract.returncode == 0,
        "QA result contract validation failed: " + (qa_contract.stderr or qa_contract.stdout).strip(),
    )

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
    require(
        any(
            item["case_type"] == "robots_denied"
            and item["fetch_controls"]["robots_evidence"] == "denied"
            and item["expected_decision"] == "deny_fetch"
            for item in crawler
        ),
        "crawler fixtures must include robots-denied deny-fetch evidence",
    )
    require(
        all(
            item["fetch_controls"]["private_ip_blocking"] is True
            and item["fetch_controls"]["redirect_validation"] is True
            and item["fetch_controls"]["dns_rebinding_guard"] is True
            for item in crawler
        ),
        "crawler fixtures must define SSRF protection controls for every case",
    )
    require(
        all(
            item["fetch_controls"]["source_rate_limit_per_hour"] > 0
            and item["fetch_controls"]["global_rate_limit_per_hour"] > 0
            for item in crawler
        ),
        "crawler fixtures must define source/global rate limits",
    )
    for case in crawler:
        require(
            case["import_governance"]["direct_activation_allowed"] is False,
            f"{case['fixture_id']} must deny direct activation",
        )
        require(
            case["import_governance"]["provenance_links_required"] is True,
            f"{case['fixture_id']} must require provenance links",
        )
        require(
            case["import_governance"]["raw_content_retention_days"] <= 30,
            f"{case['fixture_id']} raw content retention must be capped at 30 days or less",
        )
        require(
            case["import_governance"]["exact_third_party_import_warning"] is True
            and case["import_governance"]["exact_text_special_approval_required"] is True,
            f"{case['fixture_id']} must require exact-text warning and special approval",
        )
        require(
            case["import_governance"]["source_blocklist_checked"] is True,
            f"{case['fixture_id']} must check source blocklist",
        )
        require(
            case["import_governance"]["takedown_workflow_required"] is True
            and case["import_governance"]["derivative_review_delete_required"] is True,
            f"{case['fixture_id']} must require takedown and derivative review/delete workflow",
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


def validate_abuse_evidence_split_contracts() -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked_lines = checked_items(text)
    unchecked_lines = unchecked_items(text)
    admin_governance = (ROOT / "admin" / "tests" / "admin-governance.test.mjs").read_text(encoding="utf-8")
    admin_fixtures = (ROOT / "admin" / "lib" / "fixtures.ts").read_text(encoding="utf-8")
    admin_runtime = (ROOT / "admin" / "lib" / "abuse-runtime.ts").read_text(encoding="utf-8")
    admin_abuse_page = (ROOT / "admin" / "app" / "abuse" / "page.tsx").read_text(encoding="utf-8")
    private_beta = load_json(FIXTURE_DIR / "release_gate_evidence.private_beta_staging.json")
    production = load_json(FIXTURE_DIR / "release_gate_evidence.production_launch.json")

    require(
        "实现 temporary hold/throttle hooks admin fixture/evidence。" in checked_lines,
        "blueprint must close only temporary hold/throttle admin fixture evidence",
    )
    require(
        "实现 admin abuse queue fixture/evidence。" in checked_lines,
        "blueprint must close only admin abuse queue fixture evidence",
    )
    require(
        "temporary hold/throttle hooks runtime enforcement 通过。" in checked_lines,
        "temporary hold/throttle runtime enforcement must close only with executable admin runtime evidence",
    )
    require(
        "admin abuse queue runtime enforcement 通过。" in checked_lines,
        "admin abuse queue runtime enforcement must close only with executable admin runtime evidence",
    )
    for ambiguous in ["实现 temporary hold/throttle hooks。", "实现 admin abuse queue。"]:
        require(
            ambiguous not in checked_lines and ambiguous not in unchecked_lines,
            f"ambiguous abuse checklist item must stay split: {ambiguous}",
        )

    for token in [
        'test("temporary hold and throttle hooks enforce abuse controls with RBAC, expiry, and audit evidence"',
        "abuseControlHooks.length > 0",
        'actions.has("temporary_hold")',
        'actions.has("rate_limit")',
        "hook.enforcementPoint",
        "hook.rbacDecision",
        "hook.releaseEvidenceRefs",
        'test("temporary hold and throttle runtime enforcement blocks quota-consuming work and preserves audit evidence"',
        'test("admin abuse queue runtime enforcement keeps events open until controls and release evidence pass"',
        "buildAbuseRuntimeDecisions",
        "buildAbuseQueueRuntime",
    ]:
        require(token in admin_governance, f"admin abuse governance test missing {token}")

    for token in [
        "export const abuseEvents",
        "export const abuseControlHooks",
        "triggerSource: \"abuse_queue\"",
        "action: \"temporary_hold\"",
        "action: \"rate_limit\"",
        "telemetrySignal",
        "operatorRunbook",
    ]:
        require(token in admin_fixtures, f"admin abuse fixture evidence missing {token}")

    for token in [
        "export function buildAbuseRuntimeDecisions",
        "export function buildAbuseQueueRuntime",
        "deny_423_account_hold",
        "throttle_429_rate_limited",
        "canCreateQuotaConsumingTask: false",
        "closureAllowed: false",
        "blocked_by_rbac",
        "hold_until_release_evidence",
    ]:
        require(token in admin_runtime, f"admin abuse runtime enforcement missing {token}")

    for token in [
        "getAbuseRuntimeDecisions",
        "getAbuseQueueRuntime",
        "Runtime Enforcement Decisions",
        "Abuse Queue Runtime",
        "Quota Task",
        "Closure Allowed",
    ]:
        require(token in admin_abuse_page, f"admin abuse page missing runtime evidence surface {token}")

    private_beta_text = json.dumps(private_beta, ensure_ascii=False)
    production_text = json.dumps(production, ensure_ascii=False)
    private_beta_checks = checks_by_id(private_beta)
    private_beta_conditions = do_not_launch_by_id(private_beta)
    require(
        private_beta_checks["staging_auth_rbac_tenant_audit"]["status"] == "pass",
        "private beta auth/RBAC/tenant/audit gate check must pass only after staging evidence exists",
    )
    require(
        private_beta_conditions["tenant_isolation_not_enforced"]["is_present"] is False,
        "private beta tenant isolation Do-Not-Launch condition must clear after staging runtime evidence exists",
    )
    require(
        "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json" in private_beta_text
        and "external-user admin API denial" in private_beta_text
        and "cross-tenant isolation denial" in private_beta_text,
        "private beta gate must cite auth/RBAC/tenant/audit staging runtime evidence",
    )
    require(
        private_beta_checks["staging_brief_upload_confirmation"]["status"] == "pass",
        "private beta brief/upload/confirmation gate check must pass only after staging evidence exists",
    )
    require(
        private_beta_conditions["staging_brief_upload_confirmation_runtime_missing"]["is_present"] is False,
        "private beta brief/upload/confirmation Do-Not-Launch condition must clear after staging runtime evidence exists",
    )
    require(
        "ops/evidence/staging/20260526T2330Z-brief-upload-confirmation.json" in private_beta_text
        and "external-user /workspace brief confirmation" in private_beta_text
        and "four-candidate ready state" in private_beta_text,
        "private beta gate must cite brief/upload/confirmation staging runtime evidence",
    )
    require(
        private_beta_checks["staging_support_retry_abuse_ops"]["status"] == "pass",
        "private beta support/retry/abuse gate check must pass only after staging evidence exists",
    )
    require(
        private_beta_conditions["support_abuse_runtime_missing"]["is_present"] is False,
        "private beta support/abuse Do-Not-Launch condition must clear after staging runtime evidence exists",
    )
    require(
        "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json" in private_beta_text
        and "external-user support linkage" in private_beta_text
        and "hold/throttle" in private_beta_text,
        "private beta gate must cite support/retry/abuse staging runtime evidence",
    )
    production_checks = checks_by_id(production)
    production_conditions = do_not_launch_by_id(production)
    require(
        production_checks["production_abuse_throttle_hold"]["status"] == "pass",
        "production abuse throttle/hold gate check must pass only after production evidence exists",
    )
    require(
        production_conditions["abuse_throttle_hold_missing"]["is_present"] is False,
        "production abuse throttle/hold Do-Not-Launch condition must clear after production runtime evidence exists",
    )
    require(
        "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json" in production_text
        and "production account-level hold/throttle rollout evidence" in production_text
        and "unrelated provider, billing, security, backup, and legal launch blockers remain active" in production_text,
        "production gate must cite abuse throttle/hold production evidence without closing aggregate launch",
    )


def validate_staging_support_retry_abuse_evidence() -> None:
    evidence = load_json(STAGING_SUPPORT_RETRY_ABUSE_EVIDENCE)
    require(evidence["schema_version"] == "stage0.rev2", "staging support/retry/abuse evidence schema mismatch")
    require(evidence["environment"] == "staging", "support/retry/abuse evidence must be staging-scoped")
    require(evidence["status"] == "pass", "support/retry/abuse evidence must pass before checklist closure")
    require(
        evidence["release_gate_check_id"] == "staging_support_retry_abuse_ops",
        "support/retry/abuse evidence must target the private beta release-gate check",
    )
    require(
        evidence["do_not_launch_condition_id"] == "support_abuse_runtime_missing",
        "support/retry/abuse evidence must target the matching Do-Not-Launch condition",
    )
    require_check_level_evidence_gate_impact(
        evidence,
        gate="private_beta_staging",
        check_id="staging_support_retry_abuse_ops",
        evidence_name="support/retry/abuse evidence",
    )
    required_areas = {
        "support_ticket_linkage",
        "failed_task_retry_cancel",
        "abuse_hold_throttle",
        "abuse_queue_closure",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "support/retry/abuse evidence must cover support linkage, retry/cancel, hold/throttle, and abuse queue closure",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} staging support/retry/abuse coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in ["external-user", "rbac", "audit", "ops/evidence/staging/20260527t1000z-support-retry-abuse.json"]:
            require(token in combined, f"{item['area']} support/retry/abuse coverage missing {token}")
    for key in ["runtime_request_ids", "support_ticket_ids", "failed_task_ids", "abuse_event_ids", "abuse_hook_ids"]:
        require(evidence[key], f"support/retry/abuse evidence must include {key}")


def validate_staging_legal_support_visibility_evidence() -> None:
    legal_evidence = load_json(STAGING_LEGAL_EXTERNAL_PAGES_EVIDENCE)
    support_evidence = load_json(STAGING_SUPPORT_CONTACT_VISIBILITY_EVIDENCE)
    for evidence, path, kind, tokens in [
        (
            legal_evidence,
            STAGING_LEGAL_EXTERNAL_PAGES_EVIDENCE,
            "legal_pages_external_user_visibility",
            ["terms", "privacy", "acceptable use", "ai/content", "ip complaint"],
        ),
        (
            support_evidence,
            STAGING_SUPPORT_CONTACT_VISIBILITY_EVIDENCE,
            "support_contact_external_user_visibility",
            ["support", "report-problem", "external user"],
        ),
    ]:
        rel_path = rel(path)
        require(evidence.get("environment") == "staging", f"{rel_path} must be staging-scoped")
        require(evidence.get("status") == "pass", f"{rel_path} must pass before checklist closure")
        require(evidence.get("kind") == kind, f"{rel_path} must declare kind={kind}")
        require(
            evidence.get("release_gate_check_id") == "staging_legal_external_user_pages",
            f"{rel_path} must target the legal/support release gate check",
        )
        require(
            evidence.get("do_not_launch_condition_id") == "external_user_legal_pages_missing",
            f"{rel_path} must target external_user_legal_pages_missing",
        )
        gate_impact = evidence.get("gate_impact", {})
        require(
            gate_impact.get("can_clear_check_level_item") is True,
            f"{rel_path} must allow its check-level legal/support subitem to close",
        )
        combined = json.dumps(evidence, ensure_ascii=False).lower()
        missing_tokens = [token for token in tokens if token not in combined]
        require(not missing_tokens, f"{rel_path} missing required legal/support visibility tokens: {missing_tokens}")

    private_beta = load_json(RELEASE_GATE_EVIDENCE_FILES["private_beta_staging"])
    checks = checks_by_id(private_beta)
    conditions = do_not_launch_by_id(private_beta)
    require(
        checks["staging_legal_external_user_pages"]["status"] == "pass",
        "private beta legal/support check must pass after exact staging evidence exists",
    )
    require(
        conditions["external_user_legal_pages_missing"]["is_present"] is False,
        "private beta external_user_legal_pages_missing condition must clear after exact staging evidence exists",
    )
    evidence_ref = checks["staging_legal_external_user_pages"]["evidence_ref"]
    for path in [STAGING_LEGAL_EXTERNAL_PAGES_EVIDENCE, STAGING_SUPPORT_CONTACT_VISIBILITY_EVIDENCE]:
        require(rel(path) in evidence_ref, "legal/support pass evidence must cite both exact staging split files")
    require_check_level_evidence_gate_impact(
        {
            "gate_impact": {
                "checklist_item": "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。",
                "can_clear_check_level_item": True,
                "aggregate_private_beta_gate_status": "blocked_by_other_staging_runtime_items",
                "remaining_blockers": ["staging_object_storage_signed_downloads"],
            }
        },
        gate="private_beta_staging",
        check_id="staging_legal_external_user_pages",
        evidence_name="legal/support visibility evidence",
    )

def validate_staging_auth_rbac_tenant_audit_evidence() -> None:
    evidence = load_json(STAGING_AUTH_RBAC_TENANT_AUDIT_EVIDENCE)
    require(evidence["schema_version"] == "stage0.rev2", "staging auth/RBAC/tenant/audit evidence schema mismatch")
    require(evidence["environment"] == "staging", "auth/RBAC/tenant/audit evidence must be staging-scoped")
    require(evidence["status"] == "pass", "auth/RBAC/tenant/audit evidence must pass before checklist closure")
    require(
        evidence["release_gate_check_id"] == "staging_auth_rbac_tenant_audit",
        "auth/RBAC/tenant/audit evidence must target the private beta release-gate check",
    )
    require(
        evidence["do_not_launch_condition_id"] == "tenant_isolation_not_enforced",
        "auth/RBAC/tenant/audit evidence must target the matching Do-Not-Launch condition",
    )
    require_check_level_evidence_gate_impact(
        evidence,
        gate="private_beta_staging",
        check_id="staging_auth_rbac_tenant_audit",
        evidence_name="auth/RBAC/tenant/audit evidence",
    )
    required_areas = {
        "admin_session_boundary",
        "tenant_isolation_denial",
        "admin_rbac_runtime",
        "immutable_audit_linkage",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "auth/RBAC/tenant/audit evidence must cover admin session boundary, tenant denial, RBAC runtime, and immutable audit linkage",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} staging auth/RBAC/tenant/audit coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in [
            "external-user",
            "rbac",
            "audit",
            "ops/evidence/staging/20260527t1515z-auth-rbac-tenant-audit.json",
        ]:
            require(token in combined, f"{item['area']} auth/RBAC/tenant/audit coverage missing {token}")
    for key in ["runtime_request_ids", "tenant_ids", "admin_rbac_evidence_ids", "audit_refs"]:
        require(evidence[key], f"auth/RBAC/tenant/audit evidence must include {key}")


def validate_staging_brief_upload_confirmation_evidence() -> None:
    evidence = load_json(STAGING_BRIEF_UPLOAD_CONFIRMATION_EVIDENCE)
    require(evidence["schema_version"] == "stage0.rev2", "staging brief/upload evidence schema mismatch")
    require(evidence["environment"] == "staging", "brief/upload evidence must be staging-scoped")
    require(evidence["status"] == "pass", "brief/upload evidence must pass before checklist closure")
    require(
        evidence["release_gate_check_id"] == "staging_brief_upload_confirmation",
        "brief/upload evidence must target the private beta release-gate check",
    )
    require(
        evidence["do_not_launch_condition_id"] == "staging_brief_upload_confirmation_runtime_missing",
        "brief/upload evidence must target the matching Do-Not-Launch condition",
    )
    require_check_level_evidence_gate_impact(
        evidence,
        gate="private_beta_staging",
        check_id="staging_brief_upload_confirmation",
        evidence_name="brief/upload/confirmation evidence",
    )
    external_user = evidence["external_user"]
    require(external_user["route"] == "/workspace", "brief/upload evidence must validate the external-user workspace")
    require(
        external_user["source"] == "web/components/workspace-app.tsx",
        "brief/upload evidence must cite the workspace implementation source",
    )
    ui_contract = evidence["ui_contract"]
    require(ui_contract["expected_status"] == "pass", "brief/upload UI contract must pass")
    required_values = {
        "data-brief-confirmed": "true",
        "data-brief-missing-info-count": "0",
        "data-brief-latest-reference-validation": "accepted",
        "data-brief-confirmation-message-visible": "true",
        "data-brief-candidate-set-ready": "true",
    }
    for key, expected in required_values.items():
        require(
            ui_contract["expected_values"].get(key) == expected,
            f"brief/upload UI contract must require {key}={expected}",
        )
    required_areas = {
        "brief_confirmation",
        "reference_upload",
        "confirmation_message",
        "candidate_set_ready",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "brief/upload evidence must cover confirmation, upload, visible message, and candidate readiness",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} staging brief/upload coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in [
            "web/",
            "workspace",
        ]:
            require(token in combined, f"{item['area']} brief/upload coverage missing {token}")
    for key in ["runtime_request_ids", "operation_ids", "validation_commands"]:
        require(evidence[key], f"brief/upload evidence must include {key}")


def validate_staging_quota_rate_limit_spend_cap_evidence() -> None:
    evidence = load_json(STAGING_QUOTA_RATE_LIMIT_SPEND_CAP_EVIDENCE)
    require(
        evidence["schema_version"] == "stage0.rev2.staging.runtime_evidence",
        "staging quota/rate-limit/spend-cap evidence schema mismatch",
    )
    require(evidence["environment"] == "staging", "quota/rate-limit/spend-cap evidence must be staging-scoped")
    require(evidence["status"] == "pass", "quota/rate-limit/spend-cap evidence must pass before checklist closure")
    require(
        evidence["release_gate_check_id"] == "staging_quota_rate_limit_spend_cap",
        "quota/rate-limit/spend-cap evidence must target the private beta release-gate check",
    )
    require(
        evidence["do_not_launch_condition_id"] == "rate_limit_spend_cap_runtime_missing",
        "quota/rate-limit/spend-cap evidence must target the matching Do-Not-Launch condition",
    )
    require_check_level_evidence_gate_impact(
        evidence,
        gate="private_beta_staging",
        check_id="staging_quota_rate_limit_spend_cap",
        evidence_name="quota/rate-limit/spend-cap evidence",
    )
    required_areas = {
        "quota_reservation_commit_refund",
        "rate_limit_enforcement",
        "provider_spend_cap",
        "emergency_kill_switch",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "quota/rate-limit/spend-cap evidence must cover quota transactions, rate limits, provider spend cap, and emergency kill switch",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} staging quota/rate-limit/spend-cap coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in [
            "admin/",
            "ops/evidence/staging/20260527t2015z-quota-rate-limit-spend-cap.json",
        ]:
            require(token in combined, f"{item['area']} quota/rate-limit/spend-cap coverage missing {token}")
        require(
            "external-user" in combined or "external user" in combined,
            f"{item['area']} quota/rate-limit/spend-cap coverage missing external-user scope",
        )
        require(
            "audit" in combined or "au-" in combined,
            f"{item['area']} quota/rate-limit/spend-cap coverage must cite audit evidence",
        )
        require(
            any(
                token in combined
                for token in ["fail-closed", "failed closed", "429", "kill-switch", "refunded", "retry idempotency"]
            ),
            f"{item['area']} quota/rate-limit/spend-cap coverage must prove runtime enforcement",
        )
    for key in ["runtime_request_ids", "quota_user_ids", "admin_rbac_evidence_ids", "audit_refs"]:
        require(evidence[key], f"quota/rate-limit/spend-cap evidence must include {key}")


def validate_staging_object_storage_signed_url_evidence() -> None:
    evidence = load_json(STAGING_OBJECT_STORAGE_SIGNED_URL_EVIDENCE)
    require(
        evidence["schema_version"] == "stage0.rev2.staging.object_storage_signed_url",
        "staging object-storage signed URL evidence schema mismatch",
    )
    require(evidence["environment"] == "staging", "object-storage signed URL evidence must be staging-scoped")
    require(
        evidence["status"] == "pass_with_blockers_preserved",
        "object-storage signed URL evidence must preserve retention cleanup blockers",
    )
    require(
        evidence["kind"] == "object_storage_signed_url",
        "object-storage signed URL evidence must declare kind=object_storage_signed_url",
    )
    require(
        evidence["release_gate_check_id"] == "staging_object_storage_signed_downloads",
        "object-storage signed URL evidence must target the private beta object-storage release-gate check",
    )
    require(
        evidence["do_not_launch_condition_id"] == "object_storage_signed_retention_runtime_missing",
        "object-storage signed URL evidence must preserve the matching object-storage Do-Not-Launch condition",
    )
    require(
        evidence["release_sha"] == load_json(STAGING_OBSERVABILITY_RUNTIME_EVIDENCE)["release_sha"],
        "object-storage signed URL evidence must be release-SHA-bound to staging runtime evidence",
    )
    require(
        evidence["source_evidence"] == {
            "backup_restore_evidence": "ops/evidence/staging/20260527T2115Z-backup-restore.json",
            "load_evidence": "ops/evidence/staging/20260527T2120Z-load.json",
            "post_deploy_smoke_evidence": "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json",
        },
        "object-storage signed URL evidence must cite exact staging source evidence files",
    )
    required_areas = {
        "tenant_scoped_signed_download",
        "expiry_denial",
        "direct_object_denial",
        "cross_tenant_denial",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "object-storage signed URL evidence must cover tenant scope, expiry, direct-object denial, and cross-tenant denial",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} signed URL coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in ["staging", "signed", "ops/evidence/staging/20260527t2125z-post-deploy-smoke.json"]:
            require(token in combined, f"{item['area']} signed URL coverage missing {token}")
        if item["area"] == "tenant_scoped_signed_download":
            require("tenant scoped signed download" in combined, "tenant-scoped signed download proof missing")
        if item["area"] == "expiry_denial":
            require("expiry denial" in combined, "expiry denial proof missing")
        if item["area"] == "direct_object_denial":
            require("direct object denial" in combined, "direct object denial proof missing")
        if item["area"] == "cross_tenant_denial":
            require("cross tenant denial" in combined, "cross-tenant denial proof missing")
    retention_cleanup_gate = evidence["retention_cleanup_gate"]
    require(retention_cleanup_gate["status"] == "blocked", "retention cleanup must remain blocked")
    require(
        "expired export cleanup" in retention_cleanup_gate["reason"]
        and "orphan cleanup" in retention_cleanup_gate["reason"],
        "retention cleanup blocker must require expired export and orphan cleanup evidence",
    )
    gate_impact = evidence["gate_impact"]
    require(
        gate_impact["check_level_item"]
        == "Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。",
        "object-storage signed URL evidence must name the exact subitem it can clear",
    )
    require(
        gate_impact["can_clear_signed_url_checklist_item"] is True,
        "object-storage signed URL evidence must explicitly clear only the signed URL subitem",
    )
    require(
        gate_impact["can_clear_release_gate_check"] is False,
        "object-storage signed URL evidence must not clear the full object-storage release gate",
    )
    require(
        gate_impact["remaining_object_storage_blockers"] == [
            "staging object retention/cleanup runtime evidence",
        ],
        "object-storage signed URL evidence must keep retention cleanup as the remaining object-storage blocker",
    )
    require(
        gate_impact["remaining_release_gate_blockers"] == [
            "staging_object_storage_signed_downloads",
        ],
        "object-storage signed URL evidence must preserve the object-storage release blocker",
    )
    for key in ["runtime_request_ids", "object_ids", "tenant_ids", "audit_refs"]:
        require(evidence[key], f"object-storage signed URL evidence must include {key}")


def validate_staging_eval_qa_safety_evidence() -> None:
    evidence = load_json(STAGING_EVAL_QA_SAFETY_EVIDENCE)
    require(
        evidence["schema_version"] == "stage0.rev2.staging.eval_qa_safety",
        "staging eval/QA/safety evidence schema mismatch",
    )
    require(evidence["environment"] == "staging", "eval/QA/safety evidence must be staging-scoped")
    require(evidence["status"] == "pass", "eval/QA/safety evidence must pass before checklist closure")
    require(
        evidence["release_gate_check_id"] == "staging_eval_qa_safety_runtime",
        "eval/QA/safety evidence must target the private beta release-gate check",
    )
    require(
        evidence["do_not_launch_condition_id"] == "eval_qa_safety_runtime_missing",
        "eval/QA/safety evidence must target the matching Do-Not-Launch condition",
    )
    require_check_level_evidence_gate_impact(
        evidence,
        gate="private_beta_staging",
        check_id="staging_eval_qa_safety_runtime",
        evidence_name="eval/QA/safety evidence",
    )
    required_areas = {
        "brief_safety_gate",
        "provider_request_policy",
        "provider_response_policy",
        "qa_result_gate",
        "export_block_gate",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "eval/QA/safety evidence must cover all required safety enforcement points",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} staging eval/QA/safety coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in [
            "admin/",
            "ops/evidence/staging/20260527t1900z-eval-qa-safety.json",
        ]:
            require(token in combined, f"{item['area']} eval/QA/safety coverage missing {token}")
        require(
            isinstance(item.get("external_user_evidence"), str) and item["external_user_evidence"].strip(),
            f"{item['area']} eval/QA/safety coverage missing external_user_evidence",
        )
        require(
            any(token in combined for token in ["blocked", "denied", "prevented", "required admin review"]),
            f"{item['area']} eval/QA/safety coverage must prove fail-closed enforcement",
        )
    for key in [
        "runtime_request_ids",
        "trace_ids",
        "risky_export_ids",
        "admin_rbac_evidence_ids",
        "admin_review_decision_ids",
        "audit_refs",
    ]:
        require(evidence[key], f"eval/QA/safety evidence must include {key}")


def validate_partial_staging_observability_gate_impact(
    evidence: dict[str, Any],
    *,
    evidence_name: str,
    check_level_item: str,
) -> None:
    gate_impact = evidence["gate_impact"]
    require(
        gate_impact["check_level_item"] == check_level_item,
        f"{evidence_name} must name the exact check-level checklist item it can clear",
    )
    require(
        gate_impact["can_clear_check_level_item"] is True,
        f"{evidence_name} must explicitly allow only check-level closure",
    )
    require(
        gate_impact["aggregate_checklist_item"] == "Private Beta/Staging observability/backup/load runtime evidence 通过。",
        f"{evidence_name} must name the aggregate private beta observability/backup/load checklist item",
    )
    require(
        gate_impact["can_clear_aggregate_item"] is False,
        f"{evidence_name} must not claim aggregate private beta observability/backup/load closure",
    )
    require(
        gate_impact["preserved_release_gate_check_id"] == "staging_observability_backup_load",
        f"{evidence_name} must preserve the staging observability/backup/load release-gate check",
    )
    require(
        gate_impact["preserved_do_not_launch_condition_id"] == "staging_observability_restore_load_missing",
        f"{evidence_name} must preserve the staging observability/restore/load Do-Not-Launch condition",
    )
    require(
        gate_impact["aggregate_private_beta_gate_status"] == "blocked_by_other_staging_runtime_items",
        f"{evidence_name} must keep aggregate private beta gate blocked",
    )


def validate_staging_backend_worker_crawler_metrics_evidence() -> None:
    evidence = load_json(STAGING_BACKEND_WORKER_CRAWLER_METRICS_EVIDENCE)
    require(
        evidence["schema_version"] == "stage0.rev2.staging_backend_worker_crawler_metrics_runtime",
        "staging backend/worker/crawler metrics evidence schema mismatch",
    )
    require(evidence["environment"] == "staging", "backend/worker/crawler metrics evidence must be staging-scoped")
    require(
        evidence["status"] == "pass_with_blockers_preserved",
        "backend/worker/crawler metrics evidence must pass while preserving aggregate blockers",
    )
    require(
        evidence["release_gate_check_id"] == "staging_observability_backup_load",
        "backend/worker/crawler metrics evidence must target the observability/backup/load release-gate check",
    )
    require(
        evidence["blueprint_checklist_item"] == "staging backend/worker/crawler metrics runtime evidence 通过。",
        "backend/worker/crawler metrics evidence must name the checklist item it can close",
    )
    service_results = {item["service"]: item for item in evidence["metrics_results"]}
    require(
        set(service_results) == {"backend_api", "worker", "crawler"},
        "backend/worker/crawler metrics evidence must cover backend_api, worker, and crawler",
    )
    for service, item in service_results.items():
        require(item["validation_status"] == "verified", f"{service} metrics runtime evidence must be verified")
        require(item["runtime_ref"].startswith("staging-metrics-"), f"{service} metrics runtime_ref must be staging-scoped")
        require(item["scrape_target"].startswith("https://staging-"), f"{service} metrics scrape target must be staging-scoped")
        require(item["required_signals"], f"{service} metrics evidence must list required signals")
        require(item["cardinality_probe"], f"{service} metrics evidence must include cardinality/secret-safety probe")
        require(item["slo_probe"], f"{service} metrics evidence must include SLO probe")
        require(item["audit_ref"].startswith("au-"), f"{service} metrics evidence must cite audit_ref")
    gate_impact = evidence["gate_impact"]
    validate_partial_staging_observability_gate_impact(
        evidence,
        evidence_name="backend/worker/crawler metrics evidence",
        check_level_item="staging backend/worker/crawler metrics runtime evidence 通过。",
    )
    require(
        gate_impact["can_clear_metrics_checklist_item"] is True,
        "backend/worker/crawler metrics evidence must explicitly allow check-level closure",
    )
    require(
        "staging backup/restore/load runtime evidence" in gate_impact["remaining_blockers"],
        "backend/worker/crawler metrics evidence must preserve backup/restore/load blocker",
    )
    for closed_blocker in [
        "staging request id propagation runtime evidence",
        "staging structured JSON logs runtime evidence",
        "staging OpenTelemetry traces runtime evidence",
    ]:
        require(
            closed_blocker not in gate_impact["remaining_blockers"],
            f"backend/worker/crawler metrics evidence must not preserve closed telemetry blocker: {closed_blocker}",
        )


def validate_staging_observability_telemetry_evidence() -> None:
    evidence = load_json(STAGING_OBSERVABILITY_TELEMETRY_EVIDENCE)
    require(
        evidence["schema_version"] == "stage0.rev2.staging_observability_telemetry_runtime",
        "staging observability telemetry evidence schema mismatch",
    )
    require(evidence["environment"] == "staging", "observability telemetry evidence must be staging-scoped")
    require(
        evidence["status"] == "pass_with_blockers_preserved",
        "observability telemetry evidence must pass while preserving aggregate blockers",
    )
    require(
        evidence["release_gate_check_id"] == "staging_observability_backup_load",
        "observability telemetry evidence must target the observability/backup/load release-gate check",
    )
    required_items = {
        "staging request id propagation runtime evidence 通过。",
        "staging structured JSON logs runtime evidence 通过。",
        "staging OpenTelemetry traces runtime evidence 通过。",
    }
    require(
        set(evidence["closed_checklist_items"]) == required_items,
        "observability telemetry evidence must name the exact telemetry checklist rows it can close",
    )
    telemetry_results = {item["area"]: item for item in evidence["telemetry_results"]}
    require(
        set(telemetry_results) == {"request_id_propagation", "structured_json_logs", "opentelemetry_traces"},
        "observability telemetry evidence must cover request id, structured logs, and traces",
    )
    for area, item in telemetry_results.items():
        require(item["validation_status"] == "verified", f"{area} telemetry runtime evidence must be verified")
        require(item["runtime_ref"].startswith("staging-"), f"{area} telemetry runtime_ref must be staging-scoped")
        require(
            set(item["services"]) == {"admin_console", "backend_api", "worker", "crawler"},
            f"{area} telemetry evidence must cover admin, backend, worker, and crawler",
        )
        require(item["propagation_probe"], f"{area} telemetry evidence must include propagation probe")
        require(item["redaction_probe"], f"{area} telemetry evidence must include redaction probe")
        require(item["trace_linkage_probe"], f"{area} telemetry evidence must include trace linkage probe")
        require(item["audit_ref"].startswith("au-"), f"{area} telemetry evidence must cite audit_ref")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in ["tr-1004", "au-007"]:
            require(token in combined, f"{area} telemetry evidence must link {token}")
        require(
            any(token in combined for token in ["omitted", "rejected", "absent", "redact"]),
            f"{area} telemetry evidence must prove sensitive-field redaction",
        )
    gate_impact = evidence["gate_impact"]
    require(
        gate_impact["can_clear_checklist_items"] is True,
        "observability telemetry evidence must explicitly allow telemetry checklist closure",
    )
    require(
        gate_impact["aggregate_checklist_item"] == "Private Beta/Staging observability/backup/load runtime evidence 通过。",
        "observability telemetry evidence must name the aggregate private beta observability/backup/load checklist item",
    )
    require(
        gate_impact["can_clear_aggregate_item"] is False,
        "observability telemetry evidence must not claim aggregate private beta observability/backup/load closure",
    )
    require(
        gate_impact["preserved_release_gate_check_id"] == "staging_observability_backup_load",
        "observability telemetry evidence must preserve the staging observability/backup/load release-gate check",
    )
    require(
        gate_impact["preserved_do_not_launch_condition_id"] == "staging_observability_restore_load_missing",
        "observability telemetry evidence must preserve the staging observability/restore/load Do-Not-Launch condition",
    )
    require(
        gate_impact["aggregate_private_beta_gate_status"] == "blocked_by_other_staging_runtime_items",
        "observability telemetry evidence must keep aggregate private beta gate blocked",
    )
    for blocker in [
        "staging backup/restore/load runtime evidence",
        "staging post-deploy smoke tests",
        "staging load evidence",
    ]:
        require(
            blocker in gate_impact["remaining_blockers"],
            f"observability telemetry evidence must preserve blocker: {blocker}",
        )


def validate_staging_observability_runtime_evidence() -> None:
    evidence = load_json(STAGING_OBSERVABILITY_RUNTIME_EVIDENCE)
    blueprint_text = BLUEPRINT.read_text(encoding="utf-8")
    blueprint_checked = checked_items(blueprint_text)
    private_beta = load_json(RELEASE_GATE_EVIDENCE_FILES["private_beta_staging"])
    private_beta_checks = checks_by_id(private_beta)
    private_beta_conditions = do_not_launch_by_id(private_beta)

    require(
        STAGING_OBSERVABILITY_RUNTIME_CHECKLIST_ITEM in blueprint_checked,
        "blueprint must close only the observability-only staging runtime subitem when exact evidence exists",
    )
    require(
        evidence["schema_version"] == "stage0.rev2.staging_observability_runtime",
        "staging observability runtime evidence schema mismatch",
    )
    require(evidence["environment"] == "staging", "observability runtime evidence must be staging-scoped")
    require(evidence["kind"] == "observability", "observability runtime evidence must use kind=observability")
    require(evidence["status"] == "passed", "observability runtime evidence must pass")
    require(
        evidence["release_gate_check_id"] == "staging_observability_backup_load",
        "observability runtime evidence must target the observability/backup/load release-gate check",
    )
    require(
        re.fullmatch(r"[0-9a-f]{40}", evidence["release_sha"]),
        "observability runtime evidence must reference a full release SHA",
    )
    source_refs = set(evidence["source_evidence_refs"])
    for path in [
        STAGING_DASHBOARD_RUNTIME_EVIDENCE,
        STAGING_ALERT_RUNTIME_EVIDENCE,
        STAGING_BACKEND_WORKER_CRAWLER_METRICS_EVIDENCE,
        STAGING_OBSERVABILITY_TELEMETRY_EVIDENCE,
    ]:
        require(rel(path) in source_refs, f"observability runtime evidence must cite {rel(path)}")
    required_signals = {
        "request_id_propagation",
        "structured_json_logs",
        "opentelemetry_traces",
        "backend_worker_crawler_metrics",
        "dashboard_import",
        "alert_routes",
    }
    signals = {item["signal_id"]: item for item in evidence["signals"]}
    require(set(signals) == required_signals, "observability runtime evidence must cover all required signals")
    for signal_id, item in signals.items():
        require(item["status"] in {"passed", "validated"}, f"{signal_id} must be passed or validated")
        require(item.get("evidence_refs"), f"{signal_id} must cite evidence_refs")
        require(
            any(str(ref).startswith("ops/evidence/staging/") for ref in item["evidence_refs"]),
            f"{signal_id} must cite staging evidence file refs",
        )
        require(item.get("audit_ref", "").startswith("au-"), f"{signal_id} must cite audit_ref")
    require(signals["request_id_propagation"].get("trace_id") == "tr-1004", "request-id signal must link trace")
    require(signals["opentelemetry_traces"].get("trace_id") == "tr-1004", "trace signal must link trace")
    require(signals["structured_json_logs"].get("log_query"), "structured logs signal must cite log query")
    require(signals["backend_worker_crawler_metrics"].get("metrics_query"), "metrics signal must cite metrics query")
    require(signals["dashboard_import"].get("dashboard_uid"), "dashboard signal must cite dashboard uid")
    require(signals["alert_routes"].get("alert_rule_url"), "alert signal must cite alert rule url")
    gate_impact = evidence["gate_impact"]
    require(
        gate_impact["check_level_item"] == "staging observability runtime evidence through request-id/logs/traces/metrics/dashboards/alerts.",
        "observability runtime evidence must name only the observability subitem it can close",
    )
    require(
        gate_impact["can_clear_observability_only"] is True,
        "observability runtime evidence must explicitly allow observability-only closure",
    )
    require(
        gate_impact["aggregate_checklist_item"] == "Private Beta/Staging observability/backup/load runtime evidence 通过。",
        "observability runtime evidence must name the aggregate private beta observability/backup/load checklist item",
    )
    require(
        gate_impact["can_clear_aggregate_item"] is False,
        "observability runtime evidence must not claim aggregate observability/backup/load closure",
    )
    require(
        gate_impact["preserved_release_gate_check_id"] == "staging_observability_backup_load",
        "observability runtime evidence must preserve the combined release-gate check",
    )
    require(
        gate_impact["preserved_do_not_launch_condition_id"] == "staging_observability_restore_load_missing",
        "observability runtime evidence must preserve the restore/load Do-Not-Launch condition",
    )
    combined_check_passed = private_beta_checks["staging_observability_backup_load"]["status"] == "pass"
    require(
        combined_check_passed or private_beta_checks["staging_observability_backup_load"]["status"] == "blocked",
        "observability release-gate check must be blocked by this partial evidence or pass after combined preflight evidence",
    )
    require(
        combined_check_passed or private_beta_conditions["staging_observability_restore_load_missing"]["is_present"] is True,
        "observability-only evidence must preserve restore/load condition until combined preflight evidence clears it",
    )
    for blocker in [
        "staging backup/restore runtime evidence",
        "staging load runtime evidence",
        "staging post-deploy smoke tests",
    ]:
        require(
            blocker in gate_impact["remaining_blockers"],
            f"observability runtime evidence must preserve blocker: {blocker}",
        )


def validate_staging_observability_backup_load_preflight_evidence() -> None:
    evidence = load_json(STAGING_OBSERVABILITY_BACKUP_LOAD_PREFLIGHT_EVIDENCE)
    require(
        evidence["blueprint_source"] == "Docs/stage0_blueprint_rev2.md",
        "staging observability/backup/load preflight must cite Rev2",
    )
    require(
        evidence["created_by_lane"] == "lane5",
        "staging observability/backup/load preflight must be lane5-owned",
    )
    require(evidence["environment"] == "staging", "preflight evidence must be staging-scoped")
    require(
        evidence["kind"] == "staging_observability_backup_load_preflight",
        "preflight evidence must use the observability/backup/load preflight kind",
    )
    require(evidence["status"] == "passed", "preflight evidence must pass after restore/load/post-deploy evidence is attached")
    require(
        evidence["release_sha"] == load_json(STAGING_OBSERVABILITY_RUNTIME_EVIDENCE)["release_sha"],
        "preflight evidence must use the validated staging observability release SHA",
    )
    require(
        evidence["release_gate_check_id"] == "staging_observability_backup_load",
        "preflight evidence must preserve the staging observability/backup/load gate check",
    )
    require(
        evidence["private_beta_check_id"] == "staging_observability_backup_load",
        "preflight evidence must preserve the private beta staging observability/backup/load check",
    )
    require(
        evidence["evidence_path_policy"] == "ops/evidence/staging/",
        "preflight evidence must require staging-scoped runtime evidence paths",
    )
    require(
        evidence["inputs"]["observability_evidence"] == rel(STAGING_OBSERVABILITY_RUNTIME_EVIDENCE),
        "preflight evidence must cite the verified staging observability runtime input",
    )
    require(
        evidence["inputs"]["backup_restore_evidence"] == "ops/evidence/staging/20260527T2115Z-backup-restore.json",
        "preflight evidence must cite the verified backup/restore input",
    )
    require(
        evidence["inputs"]["load_evidence"] == "ops/evidence/staging/20260527T2120Z-load.json",
        "preflight evidence must cite the verified load input",
    )
    require(
        evidence["inputs"]["post_deploy_smoke_evidence"] == "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json",
        "preflight evidence must cite the verified post-deploy smoke input",
    )
    require(
        evidence["blocked_slots"] == [],
        "preflight evidence must not block slots after all evidence verifies",
    )
    require(
        "observability_evidence" not in evidence["blocked_slots"],
        "preflight evidence must not re-block validated observability",
    )
    require(
        evidence["verified_observability_entries"]
        == [
            "alert_routes",
            "backend_worker_crawler_metrics",
            "dashboard_import",
            "opentelemetry_traces",
            "request_id_propagation",
            "structured_json_logs",
        ],
        "preflight evidence must summarize verified observability entries",
    )
    require(
        evidence["verified_postgres_restore_entries"] == ["postgres_restore"],
        "preflight evidence must summarize verified Postgres restore entries",
    )
    require(
        evidence["verified_object_restore_entries"] == ["object_restore"],
        "preflight evidence must summarize verified object restore entries",
    )
    require(
        set(evidence["verified_load_entries"]) == {
            "chat_task",
            "crawler_throttle",
            "quota_contention",
            "signed_download",
            "worker_generation",
            "workspace_rendering",
            "zip_export",
        },
        "preflight evidence must summarize verified load entries",
    )
    require(
        set(evidence["verified_post_deploy_smoke_entries"]) == {
            "admin",
            "auth_boundary",
            "backend_health",
            "crawler_admin",
            "export_package",
            "observability",
            "quota_rate_limit",
            "signed_download",
            "web",
            "worker_task",
        },
        "preflight evidence must summarize verified post-deploy smoke entries",
    )
    require(evidence["missing_blockers"] == [], "preflight evidence must not preserve restore/load blockers after passing")
    require(evidence["overall_verified"] is True, "passed preflight evidence must set overall_verified=true")
    require(evidence["blocking_reasons"] == [], "passed preflight evidence must not list blocking reasons")
    require(
        not any(str(reason).startswith("unverified_observability_evidence") for reason in evidence["blocking_reasons"]),
        "preflight evidence must not list observability as unverified",
    )
    checks = {check["slot"]: check for check in evidence["checks"]}
    require(
        set(checks) == {
            "observability_evidence",
            "backup_restore_evidence",
            "load_evidence",
            "post_deploy_smoke_evidence",
        },
        "preflight evidence must contain all four evidence-slot checks",
    )
    observability = checks["observability_evidence"]
    require(observability["verified"] is True, "preflight evidence must verify staging observability")
    require(
        observability["ref"] == rel(STAGING_OBSERVABILITY_RUNTIME_EVIDENCE),
        "preflight observability slot must cite staging observability runtime evidence",
    )
    require(
        observability["semantic_checks"] == {
            "environment_staging": True,
            "kind_match": True,
            "local_json_file": True,
            "release_sha_match": True,
            "release_sha_present": True,
            "required_entries_have_evidence_refs": True,
            "required_entries_passed": True,
            "required_entries_present": True,
            "staging_evidence_path": True,
            "status_passed": True,
        },
        "preflight observability slot must pass every semantic check",
    )
    require(
        not observability["missing_entries"]
        and not observability["not_passed_entries"]
        and not observability["entries_missing_evidence_refs"],
        "preflight observability slot must have complete entries and refs",
    )
    required_observability_entries = {
        "request_id_propagation",
        "structured_json_logs",
        "opentelemetry_traces",
        "backend_worker_crawler_metrics",
        "dashboard_import",
        "alert_routes",
    }
    require(
        set(observability["entry_evidence_refs"]) == required_observability_entries,
        "preflight observability slot must expose every required entry ref",
    )
    for entry_id, refs in observability["entry_evidence_refs"].items():
        require(refs, f"preflight observability entry {entry_id} must cite evidence refs")
        require(
            any(str(ref).startswith("ops/evidence/staging/") for ref in refs),
            f"preflight observability entry {entry_id} must cite staging evidence",
        )
    for slot in ["backup_restore_evidence", "load_evidence", "post_deploy_smoke_evidence"]:
        check = checks[slot]
        require(check["verified"] is True, f"preflight {slot} must verify after evidence is attached")
        require(check["ref"].startswith("ops/evidence/staging/"), f"preflight {slot} must cite staging evidence")
        require(not check["missing_entries"], f"preflight {slot} must have no missing entries")
        require(not check["not_passed_entries"], f"preflight {slot} must have no non-passing entries")
        require(not check["entries_missing_evidence_refs"], f"preflight {slot} entries must cite evidence refs")
        require(
            check["required_evidence_path_prefix"] == "ops/evidence/staging/",
            f"preflight {slot} must require staging evidence path prefix",
        )
        semantic = check["semantic_checks"]
        for key, value in semantic.items():
            require(value is True, f"preflight {slot} semantic check {key} must pass")
    gate_impact = evidence["gate_impact"]
    require(
        gate_impact["can_clear_aggregate_item"] is True,
        "preflight evidence must clear the aggregate observability/backup/load item",
    )
    require(
        gate_impact["preserved_release_gate_check_id"] is None,
        "preflight evidence must not preserve the release gate after passing",
    )
    require(
        gate_impact["preserved_do_not_launch_condition_id"] is None,
        "preflight evidence must not preserve the restore/load Do-Not-Launch condition after passing",
    )
    require(gate_impact["blocked_slots"] == [], "preflight gate impact must not list blocked slots")
    require(gate_impact["closure_blockers"] == [], "preflight gate impact must not list closure blockers")
    require(
        evidence["release_gate_fixture"]["verified_for_aggregate_closure"] is True,
        "preflight evidence must verify the private beta release-gate fixture closure",
    )


def validate_staging_dashboard_runtime_evidence() -> None:
    evidence = load_json(STAGING_DASHBOARD_RUNTIME_EVIDENCE)
    require(
        evidence["schema_version"] == "stage0.rev2.staging_dashboard_runtime",
        "staging dashboard runtime evidence schema mismatch",
    )
    require(evidence["environment"] == "staging", "dashboard runtime evidence must be staging-scoped")
    require(
        evidence["status"] == "pass_with_blockers_preserved",
        "dashboard runtime evidence must pass only while preserving aggregate blockers",
    )
    require(
        evidence["source_dashboard_definition"] == rel(OBSERVABILITY_DASHBOARD),
        "dashboard runtime evidence must cite the validator-owned dashboard definition",
    )
    require(
        evidence["release_gate_check_id"] == "staging_observability_backup_load",
        "dashboard runtime evidence must target the observability/backup/load release-gate check",
    )
    require(
        evidence["blueprint_checklist_item"] == "导入并验证 staging dashboards runtime evidence。",
        "dashboard runtime evidence must name the checklist item it can close",
    )
    dashboard_results = evidence["dashboard_results"]
    require(len(dashboard_results) >= 4, "dashboard runtime evidence must cover multiple operational panels")
    require(
        all(item["runtime_ref"].startswith("staging-dashboard-") for item in dashboard_results),
        "dashboard runtime refs must be staging-scoped",
    )
    require(
        any(item.get("release_blocker_ref") for item in dashboard_results),
        "dashboard runtime evidence must preserve release blocker context instead of over-closing staging",
    )
    for item in dashboard_results:
        require(item["signals"], f"{item['dashboard_id']} dashboard evidence must list runtime signals")
        require(item["probe_result"], f"{item['dashboard_id']} dashboard evidence must include probe_result")
        require(item["audit_ref"].startswith("au-"), f"{item['dashboard_id']} dashboard evidence must cite audit_ref")
        require(
            item.get("release_blocker_ref"),
            f"{item['dashboard_id']} dashboard evidence must cite release blocker context",
        )
    gate_impact = evidence["gate_impact"]
    validate_partial_staging_observability_gate_impact(
        evidence,
        evidence_name="dashboard runtime evidence",
        check_level_item="导入并验证 staging dashboards runtime evidence。",
    )
    require(
        gate_impact["can_clear_dashboard_checklist_item"] is True,
        "dashboard runtime evidence must explicitly allow dashboard checklist closure",
    )
    for blocker in [
        "staging request id propagation runtime evidence",
        "staging structured JSON logs runtime evidence",
        "staging OpenTelemetry traces runtime evidence",
        "staging backup/restore/load runtime evidence",
    ]:
        require(
            blocker in gate_impact["remaining_blockers"],
            f"dashboard runtime evidence must preserve blocker: {blocker}",
        )


def validate_staging_alert_runtime_evidence() -> None:
    evidence = load_json(STAGING_ALERT_RUNTIME_EVIDENCE)
    require(
        evidence["schema_version"] == "stage0.rev2.staging_alert_runtime",
        "staging alert runtime evidence schema mismatch",
    )
    require(evidence["environment"] == "staging", "alert runtime evidence must be staging-scoped")
    require(evidence["status"] == "pass", "alert runtime evidence must pass before checklist closure")
    require(
        evidence["source_alert_definition"] == rel(OBSERVABILITY_ALERTS),
        "alert runtime evidence must cite the validator-owned alert definition",
    )
    require(
        evidence["release_gate_check_id"] == "staging_observability_backup_load",
        "alert runtime evidence must target the observability/backup/load release-gate check",
    )
    require(
        evidence["blueprint_checklist_item"] == "配置并验证 staging alert routes/runtime evidence。",
        "alert runtime evidence must name the checklist item it can close",
    )
    alert_results = evidence["alert_results"]
    require(len(alert_results) >= 4, "alert runtime evidence must cover multiple alert routes")
    severities = {item["severity"] for item in alert_results}
    require({"sev1", "sev2"} <= severities, "alert runtime evidence must include sev1 and sev2 route coverage")
    for item in alert_results:
        require(item["validation_status"] == "verified", f"{item['alert_route_id']} alert route must be verified")
        require(item["runtime_ref"].startswith("staging-alert-"), f"{item['alert_route_id']} runtime_ref must be staging-scoped")
        require(item["route_target"], f"{item['alert_route_id']} alert evidence must include route target")
        require(item["probe_result"], f"{item['alert_route_id']} alert evidence must include probe_result")
        require(item["audit_ref"].startswith("au-"), f"{item['alert_route_id']} alert evidence must cite audit_ref")
    gate_impact = evidence["gate_impact"]
    validate_partial_staging_observability_gate_impact(
        evidence,
        evidence_name="alert runtime evidence",
        check_level_item="配置并验证 staging alert routes/runtime evidence。",
    )
    require(
        gate_impact["can_clear_alert_checklist_item"] is True,
        "alert runtime evidence must explicitly allow alert checklist closure",
    )
    for blocker in [
        "staging request id propagation runtime evidence",
        "staging structured JSON logs runtime evidence",
        "staging OpenTelemetry traces runtime evidence",
        "staging backend/worker/crawler metrics runtime evidence",
        "staging backup/restore/load runtime evidence",
    ]:
        require(
            blocker in gate_impact["remaining_blockers"],
            f"alert runtime evidence must preserve blocker: {blocker}",
        )


def validate_production_abuse_throttle_hold_evidence() -> None:
    evidence = load_json(PRODUCTION_ABUSE_THROTTLE_HOLD_EVIDENCE)
    require(evidence["schema_version"] == "stage0.rev2", "production abuse throttle/hold evidence schema mismatch")
    require(evidence["environment"] == "production", "abuse throttle/hold evidence must be production-scoped")
    require(
        evidence["status"] == "pass_with_blockers_preserved",
        "abuse throttle/hold production evidence must preserve unrelated launch blockers",
    )
    require(
        evidence["release_gate_check_id"] == "production_abuse_throttle_hold",
        "abuse throttle/hold evidence must target the production release-gate check",
    )
    require(
        evidence["do_not_launch_condition_id"] == "abuse_throttle_hold_missing",
        "abuse throttle/hold evidence must target the matching Do-Not-Launch condition",
    )
    require_check_level_evidence_gate_impact(
        evidence,
        gate="production_launch",
        check_id="production_abuse_throttle_hold",
        evidence_name="abuse throttle/hold evidence",
    )
    required_areas = {
        "account_hold_enforcement",
        "rate_limit_enforcement",
        "rbac_audit_release",
        "gate_blocker_preservation",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "abuse throttle/hold evidence must cover account hold, rate limit, RBAC/audit, and gate preservation",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} production abuse coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in ["production", "rbac", "audit", "ops/evidence/production/20260527t1330z-abuse-throttle-hold.json"]:
            require(token in combined, f"{item['area']} production abuse coverage missing {token}")
    for key in ["runtime_request_ids", "abuse_event_ids", "abuse_hook_ids"]:
        require(evidence[key], f"abuse throttle/hold evidence must include {key}")


def validate_production_skill_release_eval_canary_evidence() -> None:
    evidence = load_json(PRODUCTION_SKILL_RELEASE_EVAL_CANARY_EVIDENCE)
    require(evidence["schema_version"] == "stage0.rev2", "production skill release evidence schema mismatch")
    require(evidence["environment"] == "production", "skill release evidence must be production-scoped")
    require(
        evidence["status"] == "pass_with_blockers_preserved",
        "skill release production evidence must preserve unrelated launch blockers",
    )
    require(
        evidence["release_gate_check_id"] == "production_skill_release_eval_canary",
        "skill release evidence must target the production release-gate check",
    )
    require(
        evidence["do_not_launch_condition_id"] == "skill_release_eval_canary_missing",
        "skill release evidence must target the matching Do-Not-Launch condition",
    )
    gate_impact = evidence["gate_impact"]
    require_check_level_evidence_gate_impact(
        evidence,
        gate="production_launch",
        check_id="production_skill_release_eval_canary",
        evidence_name="skill release evidence",
    )

    required_areas = {
        "eval_suite_gate",
        "canary_threshold_gate",
        "release_notes_gate",
        "rollback_gate",
        "gate_blocker_preservation",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "skill release evidence must cover eval, canary, release notes, rollback, and gate preservation",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} production skill release coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in [
            "production",
            "audit",
            "ops/evidence/production/20260527t1600z-skill-release-eval-canary.json",
        ]:
            require(token in combined, f"{item['area']} production skill release coverage missing {token}")
    for key in ["runtime_request_ids", "skill_version_ids", "canary_metric_ids", "release_evidence_ids", "audit_refs"]:
        require(evidence[key], f"skill release evidence must include {key}")


def validate_production_activation_review_audit_evidence() -> None:
    evidence = load_json(PRODUCTION_ACTIVATION_REVIEW_AUDIT_EVIDENCE)
    require(evidence["schema_version"] == "stage0.rev2", "production activation evidence schema mismatch")
    require(evidence["environment"] == "production", "activation review evidence must be production-scoped")
    require(
        evidence["status"] == "pass_with_blockers_preserved",
        "activation review production evidence must preserve unrelated launch blockers",
    )
    require(
        evidence["release_gate_check_id"] == "production_activation_review_audit",
        "activation review evidence must target the production release-gate check",
    )
    require(
        set(evidence["do_not_launch_condition_ids"])
        == {"activation_eval_review_audit_runtime_missing", "admin_high_risk_review_runtime_missing"},
        "activation review evidence must target both activation and high-risk admin Do-Not-Launch conditions",
    )
    gate_impact = evidence["gate_impact"]
    require_check_level_evidence_gate_impact(
        evidence,
        gate="production_launch",
        check_id="production_activation_review_audit",
        evidence_name="activation review evidence",
    )

    required_areas = {
        "skill_release_gate",
        "crawler_activation_gate",
        "prompt_activation_gate",
        "provider_routing_gate",
        "quota_override_gate",
        "safety_policy_gate",
        "export_override_gate",
        "gate_blocker_preservation",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "activation review evidence must cover all governed activation surfaces and blocker preservation",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} production activation coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in [
            "production",
            "rbac",
            "audit",
            "ops/evidence/production/20260527t1430z-activation-review-audit.json",
        ]:
            require(token in combined, f"{item['area']} production activation coverage missing {token}")
    for key in ["runtime_request_ids", "admin_rbac_evidence_ids", "admin_review_decision_ids", "audit_refs"]:
        require(evidence[key], f"activation review evidence must include {key}")


def validate_production_security_launch_checks_evidence() -> None:
    evidence = load_json(PRODUCTION_SECURITY_LAUNCH_CHECKS_EVIDENCE)
    require(evidence["schema_version"] == "stage0.rev2", "production security evidence schema mismatch")
    require(evidence["environment"] == "production", "security launch evidence must be production-scoped")
    require(
        evidence["status"] == "pass_with_blockers_preserved",
        "security launch production evidence must preserve unrelated launch blockers",
    )
    require(
        evidence["release_gate_check_id"] == "production_security_launch_checks",
        "security launch evidence must target the production release-gate check",
    )
    require(
        set(evidence["do_not_launch_condition_ids"])
        == {"security_privacy_legal_incomplete", "secret_exposure_runtime_not_verified"},
        "security launch evidence must target both security and secret-exposure Do-Not-Launch conditions",
    )
    gate_impact = evidence["gate_impact"]
    require_check_level_evidence_gate_impact(
        evidence,
        gate="production_launch",
        check_id="production_security_launch_checks",
        evidence_name="security launch evidence",
    )

    required_areas = {
        "secure_session_cookie",
        "csrf_same_site_enforcement",
        "secret_exposure_redaction",
        "admin_surface_privacy",
        "gate_blocker_preservation",
    }
    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage} == required_areas,
        "security launch evidence must cover session, CSRF, redaction, admin privacy, and blocker preservation",
    )
    for item in coverage:
        require(item["status"] == "pass", f"{item['area']} production security coverage must pass")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in [
            "production",
            "security",
            "ops/evidence/production/20260527t1700z-security-launch-checks.json",
        ]:
            require(token in combined, f"{item['area']} production security coverage missing {token}")
    for key in ["runtime_request_ids", "audit_refs"]:
        require(evidence[key], f"security launch evidence must include {key}")


def validate_production_backup_rollback_incident_admin_evidence() -> None:
    evidence = load_json(PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_EVIDENCE)
    require(evidence["schema_version"] == "stage0.rev2", "production backup/rollback admin evidence schema mismatch")
    require(evidence["environment"] == "production", "production backup/rollback admin evidence must be production-scoped")
    require(
        evidence["status"] == "blocked_by_upstream_gates",
        "production backup/rollback admin evidence must preserve upstream launch blockers",
    )
    require(
        evidence["release_gate_check_id"] == "production_backup_rollback_incident",
        "production backup/rollback admin evidence must target the production backup release-gate check",
    )
    require(
        set(evidence["do_not_launch_condition_ids"])
        == {"backup_restore_rollback_smoke_missing", "production_deploy_rollback_smoke_missing"},
        "production backup/rollback admin evidence must target both backup and deploy-smoke blockers",
    )

    gate_impact = evidence["gate_impact"]
    require(
        gate_impact["checklist_items"] == [PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_CHECKLIST_ITEM],
        "production backup/rollback admin evidence must name only the explicit admin-visible probe checklist row",
    )
    require(
        "Production post-deploy smoke tests 通过。" not in json.dumps(gate_impact, ensure_ascii=False),
        "production backup/rollback admin evidence must not reuse the ambiguous post-deploy smoke checklist label",
    )
    require(
        gate_impact["can_clear_check_level_items"] is False,
        "production backup/rollback admin evidence cannot clear production launch readiness",
    )
    require(
        gate_impact["aggregate_production_gate_status"]
        == "blocked_by_upstream_and_other_production_runtime_items",
        "production backup/rollback admin evidence must keep aggregate production launch blocked",
    )
    require(
        set(gate_impact["remaining_blockers"])
        == {
            "ci_staging_gates_not_passed",
            "production_provider_or_comp_only_mode",
            "production_paid_billing_lifecycle",
            "production_legal_support_policy",
        },
        "production backup/rollback admin evidence must preserve exact current production blockers",
    )

    coverage = evidence["coverage"]
    require(
        {item["area"] for item in coverage}
        == {
            "backup_restore",
            "rollback_drill",
            "incident_alert_path",
            "post_deploy_smoke",
            "gate_blocker_preservation",
        },
        "production backup/rollback admin evidence must cover backup, rollback, incident, smoke, and blocker preservation",
    )
    for item in coverage:
        expected_status = "blocked" if item["area"] == "gate_blocker_preservation" else "pass"
        require(
            item["status"] == expected_status,
            f"{item['area']} production backup/rollback admin evidence has wrong status",
        )
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in [
            "production",
            "ops/evidence/production/20260527t1800z-backup-rollback-incident-smoke.json",
        ]:
            require(token in combined, f"{item['area']} production backup/rollback admin evidence missing {token}")


def validate_analytics_taxonomy() -> None:
    taxonomy = load_json(FIXTURE_DIR / "analytics" / "event_taxonomy.json")
    require(
        taxonomy["blueprint_source"] == "Docs/stage0_blueprint_rev2.md",
        "analytics taxonomy must cite authoritative Rev2 blueprint",
    )
    events = {event["event_name"]: event for event in taxonomy["event_taxonomy"]}
    reports = {report["metric_name"]: report for report in taxonomy["admin_reports"]}
    require(
        set(events) == ANALYTICS_EVENTS,
        f"analytics taxonomy event mismatch: missing {sorted(ANALYTICS_EVENTS - set(events))}, extra {sorted(set(events) - ANALYTICS_EVENTS)}",
    )
    require(
        set(reports) == ANALYTICS_REPORTS,
        f"analytics taxonomy report mismatch: missing {sorted(ANALYTICS_REPORTS - set(reports))}, extra {sorted(set(reports) - ANALYTICS_REPORTS)}",
    )
    require(
        taxonomy["governance"]["private_beta_go_no_go_required"] is True
        and taxonomy["governance"]["production_go_no_go_required"] is True,
        "analytics taxonomy must be a private beta and production go/no-go input",
    )
    require(
        taxonomy["governance"]["tenant_scope_required"] is True,
        "analytics taxonomy must require tenant-scoped events",
    )

    report_ids = {report["report_id"] for report in taxonomy["admin_reports"]}
    for event_name, event in events.items():
        require("tenant_id" in event["required_context"], f"{event_name} must require tenant_id context")
        require("occurred_at" in event["required_context"], f"{event_name} must require occurred_at context")
        missing_refs = set(event["success_metric_refs"]) - report_ids
        require(not missing_refs, f"{event_name} references unknown reports: {sorted(missing_refs)}")

    event_names = set(events)
    for metric_name, report in reports.items():
        missing_sources = set(report["source_events"]) - event_names
        require(not missing_sources, f"{metric_name} references unknown events: {sorted(missing_sources)}")
        require(
            "tenant_id" in report["required_dimensions"],
            f"{metric_name} must include tenant_id dimension",
        )

    go_no_go_reports = {report["metric_name"] for report in taxonomy["admin_reports"] if report["go_no_go_signal"]}
    require(
        {
            "first_prompt_to_four_candidates",
            "four_option_selection_rate",
            "export_completion_rate",
            "cost_per_successful_package",
            "qa_warning_block_rate",
            "failed_export_rate",
            "support_ticket_rate",
            "provider_cost_anomaly",
        }
        <= go_no_go_reports,
        "analytics taxonomy missing required go/no-go reports",
    )


def validate_release_gate_evidence() -> None:
    evidence = release_evidence_by_gate()
    missing_gates = set(GATE_CHECKLIST_ITEMS.values()) - set(evidence)
    require(not missing_gates, f"release gate evidence missing gates: {sorted(missing_gates)}")
    validate_global_do_not_launch_condition_coverage(evidence)
    blueprint_text = BLUEPRINT.read_text(encoding="utf-8")
    blueprint_checked = checked_items(blueprint_text)
    blueprint_unchecked = unchecked_items(blueprint_text)
    validate_global_do_not_launch_checklist_item(
        evidence,
        blueprint_checked,
        blueprint_unchecked,
    )
    validate_split_checklist_item_evidence(
        blueprint_checked,
        blueprint_unchecked,
    )
    validate_split_release_check_state(
        evidence,
        blueprint_checked,
        blueprint_unchecked,
    )
    validate_release_gate_checklist_decision_alignment(
        evidence,
        blueprint_checked,
        blueprint_unchecked,
    )

    for gate, gate_evidence in evidence.items():
        validate_release_gate_basics(gate_evidence)
        validate_do_not_launch_condition_coverage(gate_evidence)
        validate_active_condition_evidence_refs(gate_evidence)
        validate_pass_evidence_does_not_cite_blocked_runtime_artifacts(gate_evidence)
        validate_check_condition_consistency(gate_evidence)
        validate_no_go_condition_visibility(gate_evidence)
        validate_gate_cannot_pass_with_open_items(gate, gate_evidence, blueprint_unchecked)
        validate_runtime_gate_evidence_refs(gate, gate_evidence, blueprint_unchecked)
        validate_aggregate_runtime_checklist_items(
            gate,
            gate_evidence,
            blueprint_checked,
            blueprint_unchecked,
        )
        validate_closed_gate_items_do_not_cite_preserved_blocker_evidence(
            gate,
            gate_evidence,
            blueprint_checked,
        )
    validate_release_gate_order_dependencies(evidence)

    local_alpha = load_json(FIXTURE_DIR / "release_gate_evidence.local_alpha.json")
    require(local_alpha["gate"] == "local_alpha", "release gate fixture must target local alpha")
    checks, local_alpha_conditions = validate_release_gate_basics(local_alpha)

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
    require(
        checks["local_alpha_e2e_workflow_smoke"]["status"] == "blocked",
        "local alpha end-to-end workflow smoke must remain blocked until runtime smoke evidence exists",
    )

    do_not_launch = {condition_id: item["is_present"] for condition_id, item in local_alpha_conditions.items()}
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
    local_alpha_smoke_evidence_ref = checks["local_alpha_e2e_workflow_smoke"]["evidence_ref"]
    for checklist_item, workflow_id in LOCAL_ALPHA_RELEASE_GATE_WORKFLOW_RUNTIME_CLOSED_ITEMS.items():
        require(
            checklist_item in blueprint_checked,
            "blueprint must close Local Alpha workflow release-gate evidence subitem "
            f"after exact evidence exists: {checklist_item}",
        )
        require_local_alpha_single_workflow_runtime_files(
            local_alpha_smoke_evidence_ref,
            workflow_id,
            f"{workflow_id} Local Alpha release-gate evidence subitem",
        )

    ci = load_json(FIXTURE_DIR / "release_gate_evidence.ci.json")
    require(ci["gate"] == "ci", "CI release gate fixture must target CI")
    ci_checks, ci_conditions = validate_release_gate_basics(ci)
    require(
        ci_checks["ci_draft_artifact_coverage"]["status"] == "pass",
        "CI draft artifact coverage must pass when ops CI draft evidence validates",
    )
    if CI_WORKFLOW.exists():
        require(
            ci_checks["ci_installed_workflow"]["status"] == "pass",
            "CI installed workflow check must pass when .github workflow exists",
        )
        require(
            CI_WORKFLOW_REL in ci_checks["ci_installed_workflow"]["evidence_ref"],
            f"CI installed workflow pass evidence must cite exact installed workflow path {CI_WORKFLOW_REL}",
        )
    else:
        require(
            ci_checks["ci_installed_workflow"]["status"] == "blocked",
            "CI installed workflow check must stay blocked while .github workflow is absent",
        )
    require(
        ci_checks["ci_gate_runtime_execution"]["status"] == "blocked",
        "CI gate runtime execution must stay blocked until installed PR/main workflow evidence exists",
    )
    require(
        ci_checks["ci_playwright_smoke"]["status"] == "blocked",
        "CI Playwright smoke must stay blocked until installed PR/main runtime evidence exists",
    )
    require(
        ci_checks["ci_docker_image_build"]["status"] == "blocked",
        "CI Docker image build must stay blocked until installed PR/main runtime evidence exists",
    )
    ci_do_not_launch = {condition_id: item["is_present"] for condition_id, item in ci_conditions.items()}
    require(
        ci_do_not_launch.get("ci_workflow_not_installed") is (not CI_WORKFLOW.exists()),
        "CI release evidence ci_workflow_not_installed must reflect installed workflow presence",
    )
    require(
        ci_do_not_launch.get("ci_gate_not_executed_on_main") is True,
        "CI release evidence must keep CI gate blocked until PR/main runtime execution exists",
    )
    require(
        ci_do_not_launch.get("ci_playwright_smoke_missing") is True,
        "CI release evidence must keep Playwright smoke blocker active until runtime evidence exists",
    )
    require(
        ci_do_not_launch.get("ci_docker_image_build_missing") is True,
        "CI release evidence must keep Docker image build blocker active until runtime evidence exists",
    )

    private_beta = load_json(FIXTURE_DIR / "release_gate_evidence.private_beta_staging.json")
    require(
        private_beta["gate"] == "private_beta_staging",
        "private beta/staging release gate fixture must target private_beta_staging",
    )
    private_beta_checks, private_beta_conditions = validate_release_gate_basics(private_beta)
    closed_private_beta_runtime_checks = {
        check_id
        for item, check_ids in PRIVATE_BETA_STAGING_RUNTIME_OPEN_CHECK_ITEMS.items()
        if item in blueprint_checked and item not in PARTIAL_RUNTIME_ITEMS_THAT_DO_NOT_PASS_RELEASE_CHECKS
        for check_id in check_ids
        if check_id in RELEASE_GATE_REQUIRED_CHECKS["private_beta_staging"]
    }
    for check_id in RELEASE_GATE_REQUIRED_CHECKS["private_beta_staging"]:
        expected_status = "pass" if check_id in closed_private_beta_runtime_checks else "blocked"
        require(
            private_beta_checks[check_id]["status"] == expected_status,
            f"private beta/staging release evidence {check_id} must be {expected_status} based on concrete runtime checklist evidence",
        )
    private_beta_do_not_launch = {
        condition_id: item["is_present"] for condition_id, item in private_beta_conditions.items()
    }
    cleared_private_beta_conditions = {
        "tenant_isolation_not_enforced",
        "staging_brief_upload_confirmation_runtime_missing",
        "rate_limit_spend_cap_runtime_missing",
        "eval_qa_safety_runtime_missing",
        "crawler_governance_runtime_missing",
        "crawler_material_retention_takedown_runtime_missing",
        "staging_observability_restore_load_missing",
        "external_user_legal_pages_missing",
    }
    for condition_id in RELEASE_GATE_REQUIRED_ACTIVE_CONDITIONS["private_beta_staging"]:
        expected_present = condition_id not in cleared_private_beta_conditions
        require(
            private_beta_do_not_launch.get(condition_id) is expected_present,
            f"private beta/staging release evidence {condition_id} active state must match concrete runtime evidence",
        )
    private_beta_text = json.dumps(private_beta, ensure_ascii=False)
    for token in [
        "fixture",
        "staging runtime evidence",
        "ops/evidence/staging/20260527T1900Z-eval-qa-safety.json",
        "ops/evidence/staging/legal-pages-external-user.json",
        "ops/evidence/staging/support-contact-external-user.json",
    ]:
        require(token in private_beta_text, f"private beta/staging release evidence must distinguish contract/runtime evidence: {token}")
    for stale in [
        "tenant isolation enforcement remains open",
        "QA runtime and required safety enforcement remain open",
        "25.16 legal, privacy, disclaimer, support, and IP complaint items remain open",
    ]:
        require(stale not in private_beta_text, f"private beta/staging release evidence has stale checklist wording: {stale}")

    production = load_json(FIXTURE_DIR / "release_gate_evidence.production_launch.json")
    require(production["gate"] == "production_launch", "production release gate fixture must target production_launch")
    production_checks, production_conditions = validate_release_gate_basics(production)
    closed_production_runtime_checks = {
        check_id
        for item, check_ids in PRODUCTION_RUNTIME_OPEN_CHECK_ITEMS.items()
        if item in blueprint_checked and item != PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_CHECKLIST_ITEM
        for check_id in check_ids
    }
    for check_id in RELEASE_GATE_REQUIRED_CHECKS["production_launch"]:
        expected_status = "pass" if check_id in closed_production_runtime_checks else "blocked"
        require(
            production_checks[check_id]["status"] == expected_status,
            f"production release evidence {check_id} must be {expected_status} based on concrete production runtime evidence",
        )
    production_do_not_launch = {
        condition_id: item["is_present"] for condition_id, item in production_conditions.items()
    }
    cleared_production_conditions = {
        "skill_release_eval_canary_missing",
        "activation_eval_review_audit_runtime_missing",
        "admin_high_risk_review_runtime_missing",
        "abuse_throttle_hold_missing",
        "security_privacy_legal_incomplete",
        "secret_exposure_runtime_not_verified",
    }
    for condition_id in RELEASE_GATE_REQUIRED_ACTIVE_CONDITIONS["production_launch"]:
        expected_present = condition_id not in cleared_production_conditions
        require(
            production_do_not_launch.get(condition_id) is expected_present,
            f"production release evidence {condition_id} active state must match concrete runtime evidence",
        )
    production_text = json.dumps(production, ensure_ascii=False)
    for token in [
        "evidence exists",
        "runtime evidence is absent",
        "production deployment evidence for policy visibility is absent",
    ]:
        require(token in production_text, f"production release evidence must distinguish artifact/runtime evidence: {token}")
    for stale in [
        "paid launch policies remain open",
        "skill release states, traffic allocation, canary metrics, thresholds, rollback, and eval gating open",
        "25.16 security, privacy, legal, support, and paid policy requirements remain open",
    ]:
        require(stale not in production_text, f"production release evidence has stale checklist wording: {stale}")


def validate_readme_and_architecture_contract() -> None:
    readme = ROOT / "README.md"
    require(readme.exists(), "missing README.md")

    readme_text = readme.read_text(encoding="utf-8")
    blueprint_text = BLUEPRINT.read_text(encoding="utf-8")

    for token in [
        "Docs/stage0_blueprint_rev2.md",
        "authoritative source of truth",
        "Alphane-style pure Web three-surface monorepo",
        "`web/`: user-facing Next.js application.",
        "`admin/`: admin Next.js application.",
        "`backend/`: Go API, worker, crawler, and migration commands.",
        "docker compose up --build",
    ]:
        require(token in readme_text, f"README.md missing Rev2 local-launch token: {token}")

    for token in [
        "ZenArt Stage 0 Rev2 是纯 Web 三端架构",
        "沿用 Alphane-style 三目录落地方式",
        "- `web/`：用户端。",
        "- `admin/`：管理端。",
        "- `backend/`：Go API、worker、crawler、migrate。",
        "不得拆成移动端、桌面端或多仓库服务矩阵。",
    ]:
        require(token in blueprint_text, f"blueprint missing Alphane-style pure web architecture token: {token}")

    missing = missing_repo_paths(["web", "admin", "backend", "scripts", "README.md"])
    require(not missing, f"Alphane-style pure web monorepo evidence missing paths: {missing}")


def validate_blueprint_checklist() -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked_lines = checked_items(text)
    missing = CHECKED_ITEMS - checked_lines
    require(not missing, f"blueprint missing completed fixture/schema checklist marks: {sorted(missing)}")
    unchecked_lines = unchecked_items(text)
    missing_open = REQUIRED_OPEN_ITEMS - unchecked_lines
    require(
        not missing_open,
        "blueprint must keep launch-runtime checklist items open until gate evidence passes: "
        + json.dumps(sorted(missing_open), ensure_ascii=False),
    )

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
    validate_release_gate_order_dependencies(evidence)
    validate_global_do_not_launch_checklist_item(
        evidence,
        checked_lines,
        unchecked_lines,
    )
    validate_split_checklist_item_evidence(
        checked_lines,
        unchecked_lines,
    )
    validate_split_release_check_state(
        evidence,
        checked_lines,
        unchecked_lines,
    )
    validate_release_gate_checklist_decision_alignment(
        evidence,
        checked_lines,
        unchecked_lines,
    )
    for item, gate in GATE_CHECKLIST_ITEMS.items():
        gate_item_state_count = int(item in checked_lines) + int(item in unchecked_lines)
        require(
            gate_item_state_count == 1,
            f"blueprint missing launch gate checklist item: {item}",
        )
        require(gate in evidence, f"missing release gate evidence for {gate}")
        validate_release_gate_basics(evidence[gate])
        validate_do_not_launch_condition_coverage(evidence[gate])
        validate_active_condition_evidence_refs(evidence[gate])
        validate_pass_evidence_does_not_cite_blocked_runtime_artifacts(evidence[gate])
        validate_check_condition_consistency(evidence[gate])
        validate_gate_cannot_pass_with_open_items(gate, evidence[gate], unchecked_lines)
        validate_runtime_gate_evidence_refs(gate, evidence[gate], unchecked_lines)
        validate_aggregate_runtime_checklist_items(gate, evidence[gate], checked_lines, unchecked_lines)
        blockers = gate_blockers(evidence[gate])
        if item in unchecked_lines:
            require(
                blockers["blocked_or_failing_checks"] or blockers["active_do_not_launch_conditions"],
                f"{gate} evidence must retain at least one blocker while blueprint gate item remains open",
            )
        else:
            require(
                gate_allows_checklist_completion(evidence[gate]),
                f"blueprint marks {item!r} complete but {gate} evidence still has blockers: "
                + json.dumps(blockers, ensure_ascii=False, sort_keys=True),
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
        "listAnalyticsEvents",
        "listAnalyticsReports",
        "listEvalResults",
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

    operation_blocks = re.findall(
        r"^    (get|post|put|patch|delete):\n(?P<body>(?:^      .+\n|^        .+\n|^          .+\n|^            .+\n|^              .+\n|^                .+\n|^                  .+\n)+)",
        text,
        flags=re.MULTILINE,
    )
    for method, body in operation_blocks:
        operation_match = re.search(r"operationId: ([A-Za-z0-9_]+)", body)
        operation_id = operation_match.group(1) if operation_match else f"{method} operation"
        require(
            'default:' in body and '$ref: "#/components/responses/Error"' in body,
            f"{operation_id} must declare shared ErrorEnvelope default response",
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
        "AgentTrace": ["request_id", "workflow", "schema_validation", "provenance", "safety_status", "qa_eval_status", "quota_transaction_id", "admin_visibility", "user_failure_mapping", "export_references", "artifact_links"],
        "SafetyRule": ["enforcement_points", "evaluation_contract"],
        "AnalyticsEvent": ["event_name", "required_context", "success_metric_refs", "privacy_classification"],
        "AnalyticsReport": ["metric_name", "source_events", "required_dimensions", "go_no_go_signal"],
        "EvalResult": ["suite_id", "subject", "status", "summary", "fixture_results", "storage_contract"],
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

    analytics_event = re.search(r"^    AnalyticsEvent:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)", text, flags=re.MULTILINE | re.DOTALL)
    analytics_event_body = analytics_event.group("body") if analytics_event else ""
    for event_name in ANALYTICS_EVENTS:
        require(event_name in analytics_event_body, f"AnalyticsEvent missing event enum {event_name}")
    require("uniqueItems: true" in analytics_event_body, "AnalyticsEvent required_context must be unique")

    analytics_report = re.search(r"^    AnalyticsReport:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)", text, flags=re.MULTILINE | re.DOTALL)
    analytics_report_body = analytics_report.group("body") if analytics_report else ""
    for report_name in ANALYTICS_REPORTS:
        require(report_name in analytics_report_body, f"AnalyticsReport missing metric enum {report_name}")
    require("go_no_go_signal:" in analytics_report_body, "AnalyticsReport must identify go/no-go metrics")

    trace = re.search(r"^    AgentTrace:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)", text, flags=re.MULTILINE | re.DOTALL)
    trace_body = trace.group("body") if trace else ""
    for point in SAFETY_POINTS:
        require(point in trace_body, f"AgentTrace step_name enum missing {point}")
    for token in [
        "const: true",
        "trace_provenance:",
        "safety_disclaimer_when_applicable:",
        "artifact_links:",
        "manifest_linked:",
        "qa_report_linked:",
        "safety_decision_ref:",
        "safety_decisions",
    ]:
        require(token in trace_body, f"AgentTrace completeness schema missing {token}")


def validate_trace_completeness_contract() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_trace_completeness.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "trace completeness validation failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_trace_export_gate_matrix_contract() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_trace_export_gate_matrix.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "trace export gate matrix validation failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_eval_result_contract() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_eval_result_contract.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "eval result contract validation failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_eval_storage_contract() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_eval_storage_contract.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "eval storage contract validation failed: " + (result.stderr or result.stdout).strip(),
    )
    validate_eval_storage_read_fixture_contract()


def eval_read_fixture_page(rows: list[dict[str, Any]], query: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    require("tenant_id" in query, "eval read fixture queries must include tenant_id")
    require("latest_only" in query, "eval read fixture queries must include latest_only")
    require(
        set(query) <= EVAL_READ_QUERY_FILTERS,
        f"eval read fixture query includes unsupported filters: {sorted(set(query) - EVAL_READ_QUERY_FILTERS)}",
    )
    filtered = []
    for row in rows:
        if row["tenant_id"] != query["tenant_id"]:
            continue
        if "eval_suite_id" in query and row["eval_suite_id"] != query["eval_suite_id"]:
            continue
        if "subject_type" in query and row["subject_type"] != query["subject_type"]:
            continue
        if "subject_id" in query and row["subject_id"] != query["subject_id"]:
            continue
        if "subject_version" in query and row["subject_version"] != query["subject_version"]:
            continue
        if "status" in query and row["status"] != query["status"]:
            continue
        if "completed_after" in query and row["completed_at"] <= query["completed_after"]:
            continue
        filtered.append(row)

    filtered.sort(key=lambda row: (row["completed_at"], row["created_at"]), reverse=True)
    if query.get("latest_only") is True:
        latest_rows: list[dict[str, Any]] = []
        seen_groups: set[tuple[str, ...]] = set()
        for row in filtered:
            group = tuple(row[field] for field in [
                "tenant_id",
                "eval_suite_id",
                "subject_type",
                "subject_id",
                "subject_version",
                "runner_sha256",
            ])
            if group in seen_groups:
                continue
            seen_groups.add(group)
            latest_rows.append(row)
        filtered = latest_rows

    page_token = query.get("page_token", "")
    if page_token:
        require(isinstance(page_token, str) and page_token.startswith("after:"), "eval read page_token must use after:<result_id>")
        after_id = page_token.removeprefix("after:")
        matching_indexes = [index for index, row in enumerate(filtered) if row["id"] == after_id]
        require(matching_indexes, f"eval read page_token references a result outside the filtered page: {after_id}")
        filtered = filtered[matching_indexes[0] + 1 :]

    page_size = query.get("page_size", 25)
    require(isinstance(page_size, int), "eval read page_size must be an integer")
    require(1 <= page_size <= 100, "eval read page_size must be between 1 and 100")
    page = filtered[:page_size]
    next_page_token = f"after:{page[-1]['id']}" if len(filtered) > page_size else ""
    return page, next_page_token


def validate_eval_storage_read_fixture_contract() -> None:
    contract = load_json(FIXTURE_DIR / "eval" / "eval_storage_contract.json")
    fixture = contract["read_fixture_contract"]
    table = contract["table_contract"]
    retention = contract["retention_contract"]
    rows = fixture["fixture_rows"]
    pagination_cases = fixture["pagination_cases"]
    empty_cases = fixture["expected_empty_cases"]
    row_ids = [row["id"] for row in rows]
    require(len(row_ids) == len(set(row_ids)), "eval read fixture rows must have unique ids")
    require(fixture["tenant_filter_required"] is True, "eval read fixture must require tenant scope")
    read_contract = contract["read_contract"]
    require(set(read_contract["pagination_parameters"]) == {"PageToken", "PageSize"}, "eval read contract pagination parameters mismatch")
    require(read_contract["cursor_token_format"] == "after_result_id", "eval read contract cursor token format mismatch")
    require(
        read_contract["page_size_bounds"] == {"minimum": 1, "maximum": 100, "default": 25},
        "eval read contract page size bounds mismatch",
    )
    require(fixture["ordering"] == ["completed_at_desc", "created_at_desc"], "eval read fixture ordering mismatch")
    require(set(fixture["latest_only_groups_by"]) == LATEST_ONLY_GROUP_FIELDS, "eval read latest-only grouping mismatch")
    require(table["retention_contract_ref"] == "retention_contract", "eval storage table must link retention contract")
    for field in [
        "retain_pass_fail_blocked_results",
        "retain_summary_json",
        "retain_runner_hash",
        "deletion_requires_admin_audit",
        "redaction_requires_admin_audit",
        "no_public_delete_operation",
    ]:
        require(retention[field] is True, f"eval retention contract must set {field}")
    require(retention["minimum_retention_days"] >= 365, "eval retention must be at least 365 days")

    tenants = {row["tenant_id"] for row in rows}
    require(len(tenants) >= 2, "eval read fixture must include cross-tenant rows")
    require(
        any(
            left["tenant_id"] != right["tenant_id"]
            and left["eval_suite_id"] == right["eval_suite_id"]
            and left["subject_type"] == right["subject_type"]
            and left["subject_id"] == right["subject_id"]
            for left in rows
            for right in rows
        ),
        "eval read fixture must exercise same subject across tenants",
    )
    require(
        any(
            left["id"] != right["id"]
            and left["tenant_id"] == right["tenant_id"]
            and left["eval_suite_id"] == right["eval_suite_id"]
            and left["subject_type"] == right["subject_type"]
            and left["subject_id"] == right["subject_id"]
            and left["subject_version"] == right["subject_version"]
            and left["runner_sha256"] == right["runner_sha256"]
            and left["completed_at"] == right["completed_at"]
            and left["created_at"] != right["created_at"]
            for left in rows
            for right in rows
        ),
        "eval read fixture must exercise created_at tie-break within latest-only group",
    )

    required_case_ids = {
        "tenant_subject_filter_orders_by_completed_then_created",
        "status_and_completed_after_are_applied_after_tenant_scope",
        "latest_only_uses_runner_hash_scope_and_created_at_tiebreak",
        "subject_version_filter_keeps_old_version_addressable",
        "tenant_isolation_keeps_newer_other_tenant_out_of_acme_reads",
    }
    cases = {case["case_id"]: case for case in fixture["cases"]}
    require(set(cases) == required_case_ids, "eval read fixture cases mismatch")
    for case in fixture["cases"]:
        page, next_page_token = eval_read_fixture_page(rows, case["query"])
        actual_ids = [row["id"] for row in page]
        require(actual_ids == case["expected_result_ids"], f"{case['case_id']} expected read results mismatch")
        require(next_page_token == "", f"{case['case_id']} non-pagination case must not return a next page token")
        require(case["expected_result_ids"], f"{case['case_id']} positive read case must expect at least one row")

    required_pagination_case_ids = {
        "page_size_limits_after_stable_order",
        "page_token_resumes_after_prior_result_inside_tenant_scope",
    }
    pagination_by_id = {case["case_id"]: case for case in pagination_cases}
    require(set(pagination_by_id) == required_pagination_case_ids, "eval read pagination fixture cases mismatch")
    first_page = pagination_by_id["page_size_limits_after_stable_order"]
    second_page = pagination_by_id["page_token_resumes_after_prior_result_inside_tenant_scope"]
    require(first_page["query"]["page_size"] == 2, "eval read first pagination case must force a short page")
    require(first_page["expected_next_page_token"], "eval read first pagination case must emit a next page token")
    require(
        second_page["query"]["page_token"] == first_page["expected_next_page_token"],
        "eval read second pagination case must resume from first page token",
    )
    for case in pagination_cases:
        page, next_page_token = eval_read_fixture_page(rows, case["query"])
        actual_ids = [row["id"] for row in page]
        require(actual_ids == case["expected_result_ids"], f"{case['case_id']} expected paginated read results mismatch")
        require(
            next_page_token == case["expected_next_page_token"],
            f"{case['case_id']} expected next page token mismatch",
        )
        require(case["expected_result_ids"], f"{case['case_id']} pagination case must expect rows")
        require(
            all(
                next(row for row in rows if row["id"] == result_id)["tenant_id"] == case["query"]["tenant_id"]
                for result_id in case["expected_result_ids"]
            ),
            f"{case['case_id']} returned a row outside query tenant",
        )

    required_empty_case_ids = {
        "completed_after_is_strict_and_tenant_scoped",
        "subject_version_filter_excludes_other_versions",
        "unknown_subject_returns_empty_inside_tenant_scope",
    }
    empty_by_id = {case["case_id"]: case for case in empty_cases}
    require(set(empty_by_id) == required_empty_case_ids, "eval read empty fixture cases mismatch")
    for case in empty_cases:
        require(case["expected_result_ids"] == [], f"{case['case_id']} must be an empty read case")
        page, next_page_token = eval_read_fixture_page(rows, case["query"])
        actual_ids = [row["id"] for row in page]
        require(actual_ids == [], f"{case['case_id']} expected empty read results mismatch")
        require(next_page_token == "", f"{case['case_id']} empty case must not return a next page token")
    strict_case = empty_by_id["completed_after_is_strict_and_tenant_scoped"]
    require(
        any(
            row["tenant_id"] == strict_case["query"]["tenant_id"]
            and row["eval_suite_id"] == strict_case["query"]["eval_suite_id"]
            and row["subject_type"] == strict_case["query"]["subject_type"]
            and row["subject_id"] == strict_case["query"]["subject_id"]
            and row["status"] == strict_case["query"]["status"]
            and row["completed_at"] == strict_case["query"]["completed_after"]
            for row in rows
        ),
        "eval read strict completed_after empty case must include an equal timestamp row",
    )

    tenant_case = cases["tenant_isolation_keeps_newer_other_tenant_out_of_acme_reads"]
    require(
        all(
            next(row for row in rows if row["id"] == result_id)["tenant_id"] == tenant_case["query"]["tenant_id"]
            for result_id in tenant_case["expected_result_ids"]
        ),
        "tenant isolation read case returned a row outside query tenant",
    )

    openapi = OPENAPI.read_text(encoding="utf-8")
    eval_path = re.search(r"^  /eval/results:\n(?P<body>.*?)(?=^  /|\Z)", openapi, flags=re.MULTILINE | re.DOTALL)
    require(eval_path is not None, "OpenAPI /eval/results missing")
    require("PageToken" in eval_path.group("body"), "OpenAPI /eval/results must expose PageToken")
    require("PageSize" in eval_path.group("body"), "OpenAPI /eval/results must expose PageSize")
    require("TenantIdFilter" in eval_path.group("body"), "OpenAPI /eval/results must require tenant_id filter")
    require("SubjectVersionFilter" in eval_path.group("body"), "OpenAPI /eval/results must expose subject_version filter")
    tenant_filter = re.search(r"^    TenantIdFilter:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)", openapi, flags=re.MULTILINE | re.DOTALL)
    require(tenant_filter is not None, "OpenAPI TenantIdFilter missing")
    require("name: tenant_id" in tenant_filter.group("body"), "TenantIdFilter must filter tenant_id")
    require("required: true" in tenant_filter.group("body"), "TenantIdFilter must be required")


def validate_activation_gate_contract() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_activation_gate_contract.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "activation gate contract validation failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_safety_enforcement_contract() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_safety_enforcement_contract.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "safety enforcement contract validation failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_qa_result_coverage_contract() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_qa_result_coverage.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "QA result coverage validation failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_qa_enforcement_matrix_contract() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_qa_enforcement_matrix.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "QA enforcement matrix validation failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_export_override_contract() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_export_override_contract.py")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "export override contract validation failed: " + (result.stderr or result.stdout).strip(),
    )


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


def validate_blueprint_evidence_backfill_contracts() -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked_lines = checked_items(text)
    unchecked_lines = unchecked_items(text)

    web_validation = (ROOT / "web" / "validation" / "user-routes-smoke.json").read_text(encoding="utf-8")
    web_state_test = (ROOT / "web" / "lib" / "dev-state.test.ts").read_text(encoding="utf-8")
    web_legal = (ROOT / "web" / "lib" / "legal-policies.ts").read_text(encoding="utf-8")
    admin_governance = (ROOT / "admin" / "tests" / "admin-governance.test.mjs").read_text(encoding="utf-8")
    backend_services = (ROOT / "backend" / "internal" / "stage0" / "services.go").read_text(encoding="utf-8")
    backend_services_test = (ROOT / "backend" / "internal" / "stage0" / "services_test.go").read_text(encoding="utf-8")
    backend_config = (ROOT / "backend" / "internal" / "config" / "config.go").read_text(encoding="utf-8")
    backend_server = (ROOT / "backend" / "internal" / "server" / "server.go").read_text(encoding="utf-8")
    backend_middleware = (ROOT / "backend" / "internal" / "server" / "middleware.go").read_text(encoding="utf-8")
    backend_server_test = (ROOT / "backend" / "internal" / "server" / "server_test.go").read_text(encoding="utf-8")
    support_migration = (ROOT / "backend" / "migrations" / "0006_support_ticket_evidence_links.sql").read_text(encoding="utf-8")
    security_redact = (ROOT / "backend" / "internal" / "security" / "redact.go").read_text(encoding="utf-8")
    security_redact_test = (ROOT / "backend" / "internal" / "security" / "redact_test.go").read_text(encoding="utf-8")

    require(
        "实现 support ticket 前端上下文：project/task/trace/asset/export/quota 可见并随 report problem 生成。"
        in checked_lines,
        "blueprint must close only the support ticket frontend context evidence subitem",
    )
    for token in [
        "report-problem tickets retain project, export, task, trace, asset, and quota context",
        "linked-task-trace-asset-context",
        "linked-quota-snapshot",
    ]:
        require(token in web_validation, f"web support context evidence missing {token}")
    for token in [
        "buildSupportProblemContext",
        "linkedTraceId: \"trace-export-009\"",
        "linkedAssetIds",
        "linkedQuotaSnapshot",
    ]:
        require(token in web_state_test, f"web support context test missing {token}")

    require(
        "实现 admin support ticket 关联证据视图：user/trace/export/quota/audit 引用可查。"
        in checked_lines,
        "blueprint must close only the admin support evidence view subitem",
    )
    for token in [
        'test("support tickets link user, trace, export, quota, and audit evidence"',
        "supportUserIds.has(ticket.userId)",
        "traceIds.has(ticket.traceId)",
        "exportIds.has(ticket.exportId)",
        "quotaUserIds.has(ticket.userId)",
        "auditIds.has(ticket.auditRef)",
    ]:
        require(token in admin_governance, f"admin support evidence test missing {token}")
    require(
        "support ticket 后端持久化并强制关联 user/project/task/trace/asset/export/quota。"
        in checked_lines,
        "blueprint must close backend-enforced support ticket linkage after backend persistence evidence exists",
    )
    for token in [
        "TaskID",
        "TraceID",
        "AssetID",
        "LinkedExportID",
        "QuotaBucketID",
        "INSERT INTO support_tickets",
        "support_ticket_created",
    ]:
        require(token in backend_services, f"backend support ticket persistence missing {token}")
    for token in [
        "TestCreateSupportTicketPersistsTenantUserAndLinks",
        "TestListSupportTicketsReturnsEvidenceLinks",
        "task_id",
        "trace_id",
        "asset_id",
        "linked_export_id",
        "quota_bucket_id",
    ]:
        require(token in backend_services_test, f"backend support ticket evidence tests missing {token}")
    for token in [
        "task_id",
        "trace_id",
        "asset_id",
        "linked_export_id",
        "quota_bucket_id",
    ]:
        require(token in support_migration, f"support ticket evidence migration missing {token}")
    for token in [
        "fk_support_tickets_tenant_task",
        "fk_support_tickets_tenant_trace",
        "fk_support_tickets_tenant_asset",
        "fk_support_tickets_tenant_quota",
    ]:
        require(token in support_migration, f"support ticket tenant-scoped FK migration missing {token}")
    require(
        "support ticket 关联 user/project/task/trace/asset/export/quota。" not in unchecked_lines
        and "support ticket 关联 user/project/task/trace/asset/export/quota。" not in checked_lines,
        "ambiguous support ticket linkage checklist item must stay split into evidence and backend-enforcement subitems",
    )

    require(
        "实现 secure cookie 和 same-site CSRF 客户端/session contract evidence。" in checked_lines,
        "blueprint must close only secure cookie / same-site CSRF client contract evidence",
    )
    for token in [
        "__Host-zenart_session",
        "httpOnly: true",
        "secure: true",
        "sameSite: \"lax\"",
        "same-site-origin-check",
        "X-ZenArt-CSRF",
    ]:
        require(token in web_state_test, f"web session contract test missing {token}")
    require(
        "配置 Web/generated client CSRF same-site request contract。" in checked_lines,
        "blueprint must close only Web/generated client CSRF request contract evidence",
    )
    require(
        "后端/API runtime 验证 CSRF 或 same-site strategy。" in checked_lines,
        "blueprint must close backend CSRF/same-site runtime after middleware evidence exists",
    )
    for token in [
        "CSRFHeaderName",
        "CSRFHeaderValue",
        "X-ZenArt-CSRF",
        "same-site-origin-check",
    ]:
        require(token in backend_config, f"backend CSRF config missing {token}")
    for token in [
        "func withSameSiteCSRF",
        "csrfProtectedMethod",
        "csrf_required",
        "csrf_origin_required",
        "csrf_origin_denied",
        "same-site-origin-check",
    ]:
        require(token in backend_middleware, f"backend CSRF middleware missing {token}")
    for token in [
        "TestStateChangingAPIRequiresSameSiteCSRFHeader",
        "setSameSiteCSRFHeaders",
        "csrf_required",
        "csrf_origin_denied",
    ]:
        require(token in backend_server_test, f"backend CSRF tests missing {token}")
    require(
        "配置 CSRF 或 same-site strategy。" not in unchecked_lines
        and "配置 CSRF 或 same-site strategy。" not in checked_lines,
        "ambiguous CSRF/same-site checklist item must stay split into web contract and backend runtime subitems",
    )
    generated_client = (ROOT / "web" / "lib" / "generated" / "zenart-api.ts").read_text(encoding="utf-8")
    for token in [
        "credentials: defaultSameSiteCsrfContract.credentialMode",
        "headers: buildCsrfRequestHeaders(operation.method, headers)",
    ]:
        require(token in generated_client, f"generated web API client CSRF contract missing {token}")
    require(
        "generated web API client sends same-site credentials and X-ZenArt-CSRF header on state-changing operations"
        in (ROOT / "web" / "validation" / "user-routes-smoke.json").read_text(encoding="utf-8"),
        "web route smoke evidence must include generated client CSRF request contract",
    )
    require(
        "后端设置并验证 secure/HttpOnly/SameSite session cookies。" in checked_lines,
        "blueprint must close backend secure cookie enforcement after server evidence exists",
    )
    for token in [
        "SessionCookieName",
        "AdminSessionCookieName",
        "SessionCookieSecure",
        "SessionCookieSameSite",
        "__Host- session cookies require SESSION_COOKIE_SECURE=true",
        "__Host- session cookies must not set SESSION_COOKIE_DOMAIN",
    ]:
        require(token in backend_config, f"backend secure cookie config validation missing {token}")
    for token in [
        "http.SetCookie",
        "HttpOnly: true",
        "Secure:   s.cfg.Auth.SessionCookieSecure",
        "SameSite: sessionSameSite",
        "signSessionCookie",
    ]:
        require(token in backend_server, f"backend session cookie implementation missing {token}")
    for token in [
        "verifySessionCookie",
        "principalFromSessionCookieConfig",
        "AdminSessionCookieName",
    ]:
        require(token in backend_middleware, f"backend session cookie middleware missing {token}")
    for token in [
        "TestLocalSessionSetsSecureHttpOnlySameSiteCookie",
        "TestSessionCookieAuthenticatesRequest",
        "TestAdminRouteUsesAdminCookieWhenUserCookieAlsoPresent",
        "TestUserRouteRejectsAdminCookieOnly",
        "HttpOnly",
        "Secure",
        "SameSiteLaxMode",
    ]:
        require(token in backend_server_test, f"backend secure cookie tests missing {token}")
    require(
        "实现 secure cookies。" not in unchecked_lines and "实现 secure cookies。" not in checked_lines,
        "ambiguous secure cookies checklist item must stay split into client evidence and backend-enforcement subitems",
    )

    require("实现 secret redaction。" in checked_lines, "blueprint must close secret redaction evidence")
    for token in [
        "func RedactValue",
        "func RedactMap",
        "func RedactString",
        "exported traces",
        "support records",
    ]:
        require(token in security_redact, f"secret redaction implementation missing {token}")
    for token in [
        "TestRedactMapRemovesNestedSecrets",
        "TestRedactStringHandlesBearerAndAssignments",
        "api_key",
        "session_token",
        "Bearer abc123",
        "password=hunter2",
    ]:
        require(token in security_redact_test, f"secret redaction tests missing {token}")
    require(
        "Secrets 或 provider keys 可进入 frontend bundle、logs、traces、exports、crawler findings、screenshots、support tickets 或 admin UI。"
        in text,
        "Do-Not-Launch secret exposure condition must remain in the blueprint",
    )

    require(
        "visible support contact" in web_legal
        or "support@zenart.local" in web_legal,
        "legal evidence must expose visible support contact",
    )


def validate_launch_readiness_split_contracts() -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked_lines = checked_items(text)
    unchecked_lines = unchecked_items(text)

    ci_text = CI_DRAFT.read_text(encoding="utf-8")
    ci_evidence = load_json(CI_DRAFT_EVIDENCE)
    release_ops = load_json(RELEASE_OPS_EVIDENCE)
    observability = load_json(OBSERVABILITY_EVIDENCE)
    dashboard = load_json(OBSERVABILITY_DASHBOARD)
    alerts = load_json(OBSERVABILITY_ALERTS)

    for split_id, split in CRAWLER_GOVERNANCE_SPLIT_ITEMS.items():
        require(
            split["contract_item"] in checked_lines,
            f"blueprint must close crawler governance contract evidence subitem {split_id}: {split['contract_item']}",
        )
        require(
            split["runtime_item"] in checked_lines,
            f"blueprint must close crawler governance runtime subitem after implementation evidence {split_id}: {split['runtime_item']}",
        )
    private_beta = load_json(FIXTURE_DIR / "release_gate_evidence.private_beta_staging.json")
    staging_crawler_check = checks_by_id(private_beta)["staging_crawler_approval_provenance"]
    staging_crawler_runtime_item = "staging crawler fetch/import governance runtime evidence 通过：source approval、robots、SSRF、rate limits、retention、exact-text warning、provenance links、source blocklist 均有 staging evidence。"
    require(
        staging_crawler_runtime_item in checked_lines,
        "staging crawler runtime evidence checklist item must close only after staging evidence exists",
    )
    require(
        staging_crawler_check["status"] == "pass",
        "Private Beta/Staging crawler release gate check must pass after staging crawler runtime evidence exists",
    )
    require(
        "ops/evidence/staging/20260527T1100Z-crawler-governance-runtime.json"
        in staging_crawler_check["evidence_ref"],
        "Private Beta/Staging crawler gate must cite staging crawler runtime evidence",
    )

    crawler_runtime_tests = (ROOT / "backend" / "internal" / "stage0" / "services_test.go").read_text(encoding="utf-8")
    crawler_runtime_impl = (ROOT / "backend" / "internal" / "stage0" / "services.go").read_text(encoding="utf-8")
    for token in [
        "TestStartCrawlerRunRequiresApprovalRobotsLegalAndRatePolicy",
        "TestStartCrawlerRunBlocksUnapprovedRobotsDeniedAndPrivateHosts",
        "TestStartCrawlerRunBlocksDNSRebindingToPrivateIP",
        "TestStartCrawlerRunBlocksWhenRateLimitExceeded",
        "TestImportCrawlerFindingRequiresProvenanceRetentionAndExactTextWarning",
        "TestImportCrawlerFindingRejectsOffSourceHost",
        "TestImportCrawlerFindingRejectsMissingProvenance",
        "TestImportCrawlerFindingRejectsMismatchedProvenance",
    ]:
        require(token in crawler_runtime_tests, f"crawler runtime evidence test missing {token}")
    for token in [
        "crawler source approval is required",
        "crawler robots evidence does not allow fetch",
        "crawler URL resolved to a private or local address",
        "crawler global rate limit exceeded",
        "crawler source rate limit exceeded",
        "crawler raw retention must be between 1 and 30 days",
        "exact-text import requires review before use",
        "crawler import provenance must include source_url, fetched_at, robots_policy, and content_hash",
        "crawler URL host is blocklisted",
    ]:
        require(token in crawler_runtime_impl, f"crawler runtime enforcement missing {token}")

    for ambiguous in [
        "实现 robots evidence。",
        "实现 SSRF protections。",
        "实现 source/global rate limits。",
        "实现 raw content retention limit。",
        "实现 exact-text import warning。",
        "实现 provenance links。",
        "实现 source blocklist。",
    ]:
        require(
            ambiguous not in checked_lines and ambiguous not in unchecked_lines,
            f"ambiguous crawler governance checklist item must stay split: {ambiguous}",
        )

    for item in [
        "CI 定义 Playwright smoke draft/evidence。",
        "CI 定义 Docker image build draft/evidence。",
        "定义 staging deploy plan。",
        "定义 request id propagation staging smoke contract。",
        "定义 structured JSON logs contract。",
        "定义 OpenTelemetry traces contract。",
        "定义 backend/worker/crawler metrics contract。",
        "定义 dashboards。",
        "定义 alerts。",
        "定义 release gate evidence schema/fixtures 和 no-go release notes renderer。",
        "定义 post-deploy smoke evidence contract。",
    ] + sorted(RELEASE_GATE_BACKFILL_CHECKED_ITEMS):
        require(item in checked_lines, f"blueprint must close definition-only evidence subitem: {item}")

    for item in [
        "CI 在已安装 PR/main workflow 中运行 Playwright smoke。",
        "CI 在已安装 PR/main workflow 中 build Docker images。",
        PRODUCTION_POST_DEPLOY_LAUNCH_CLEARING_CHECKLIST_ITEM,
    ] + sorted(CI_RUNTIME_OPEN_CHECK_ITEMS) + sorted(RELEASE_GATE_RUNTIME_OPEN_ITEMS) + sorted(
        set(RELEASE_GATE_CHECK_LEVEL_RUNTIME_OPEN_ITEMS)
        - {
            "Private Beta/Staging auth/RBAC/tenant/audit runtime evidence 通过。",
            "Private Beta/Staging brief/upload/confirmation runtime evidence 通过。",
            "Private Beta/Staging crawler approval/provenance runtime evidence 通过。",
            "Private Beta/Staging eval/QA/safety enforcement runtime evidence 通过。",
            "Private Beta/Staging quota/rate-limit/spend-cap runtime evidence 通过。",
            "Private Beta/Staging support/retry/abuse runtime evidence 通过。",
            "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。",
            "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
            "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。",
            "Private Beta/Staging object storage signed URL runtime evidence 通过：staging evidence proves tenant-scoped signed download, expiry, direct-object denial, and cross-tenant denial under `ops/evidence/staging/`。",
            "staging request id propagation runtime evidence 通过。",
            "staging structured JSON logs runtime evidence 通过。",
            "staging OpenTelemetry traces runtime evidence 通过。",
            "staging backend/worker/crawler metrics runtime evidence 通过。",
            STAGING_OBSERVABILITY_RUNTIME_CHECKLIST_ITEM,
            "Private Beta/Staging observability/backup/load runtime evidence 通过。",
            "Private Beta/Staging backup/restore runtime evidence 通过：staging evidence proves Postgres restore and object restore entries required by `staging_observability_backup_load` preflight。",
            "Private Beta/Staging load runtime evidence 通过：staging evidence proves chat/task、worker generation、ZIP export、signed download、crawler throttle、quota contention、workspace rendering load entries required by `staging_observability_backup_load` preflight。",
            "Production skill release/eval/canary runtime/deployment evidence 通过。",
            "Production activation review/audit runtime/deployment evidence 通过。",
            "Production abuse throttle/hold runtime/deployment evidence 通过。",
            "Production security launch-check runtime/deployment evidence 通过。",
            PRODUCTION_BACKUP_ROLLBACK_INCIDENT_ADMIN_CHECKLIST_ITEM,
            *LOCAL_ALPHA_RELEASE_GATE_WORKFLOW_RUNTIME_CLOSED_ITEMS.keys(),
        }
    ):
        require(item in unchecked_lines, f"blueprint must keep runtime launch-readiness subitem open: {item}")

    for ambiguous in [
        "CI 运行 Playwright smoke。",
        "CI build Docker images。",
        "实现 staging deploy。",
        "实现 dashboards。",
        "实现 alerts。",
        "实现 request id propagation。",
        "实现 structured JSON logs。",
        "实现 OpenTelemetry traces。",
        "实现 backend/worker/crawler metrics。",
        "Post-deploy smoke tests 通过。",
        "Backfill release gate evidence。",
        "Runtime release gate evidence 通过。",
        "Private Beta/Staging runtime evidence 通过。",
        "Production runtime evidence 通过。",
        "Production post-deploy smoke tests 通过。",
    ]:
        require(
            ambiguous not in checked_lines and ambiguous not in unchecked_lines,
            f"ambiguous launch-readiness checklist item must stay split: {ambiguous}",
        )

    for token in [
        "Fixture or contract evidence can never close CI, Private Beta/Staging, Production Launch, or Do-Not-Launch checklist items by itself",
        "Runtime gate checks that pass must cite environment-specific evidence paths",
        "Each release gate fixture must include a `gate_decision` object",
        "must contain unique non-empty IDs",
        "Required release gate checks cannot use `not_applicable`",
        "without pass evidence must remain `blocked` or `fail`",
        "must preserve fixture order from the current blocked/failing checks",
        "`gate_decision.status` must also align with the authoritative checklist",
        "each open gate checklist item requires the matching fixture decision to stay `no_go`",
        "each checked gate checklist item requires the matching fixture decision to be `go`",
        "a fixture-level `go` decision is invalid while any check is blocked/failing or any Do-Not-Launch condition is active",
        "For a `no_go` fixture, `gate_decision.evidence_ref` must name every blocked/failing check ID",
        "and every active Do-Not-Launch condition ID from the same fixture",
        "If a gate checklist item remains open, its release gate fixture must still contain at least one computed blocker",
        "CI, Private Beta/Staging, and Production gate fixtures may not be `no_go` with zero active Do-Not-Launch conditions",
        "Local Alpha may remain `no_go` with zero active Do-Not-Launch conditions only for local workflow runtime smoke",
        "Passed runtime gate checks must cite exact validator-owned evidence files when the checklist subitem is closed by a named `ops/evidence` artifact",
        "Passed runtime evidence files must declare the expected environment",
        "must themselves have a passing status",
        "blocked preflight reports, files with `blocked_slots`, or files with `missing_blockers` cannot be cited as pass evidence",
        "stale or cross-gate evidence cannot close a runtime check",
        "Checked runtime subitems that partially satisfy a larger release gate must have validator-owned file-level checks",
        "Private Beta/Staging checked partial subitems must be backed by named validator constants",
        "A top-level gate checklist item, aggregate runtime checklist item, global Do-Not-Launch item, or fixture-level `go` decision cannot cite runtime evidence that preserves blockers",
        "status=pass_with_blockers_preserved",
        "can_clear_aggregate_item=false",
        "Passed gate checks and cleared Do-Not-Launch conditions may not mix real and missing concrete artifact paths",
        "Private Beta/Staging check-level runtime subitems must remain open until each matching release gate check has staging evidence",
        "Private Beta/Staging object storage signed download/retention cannot close from local object storage tests",
        "Private Beta/Staging legal/support visibility cannot close from web source files or policy text alone",
        "Production check-level runtime subitems must remain open until each matching release gate check has production evidence",
        "Private Beta/Staging observability runtime evidence may close only its observability-only subitem",
        "observability-only artifact preserved backup/restore、load、post-deploy smoke blockers until the later combined preflight closed them",
        "clears auth/RBAC/tenant/audit, brief/upload/confirmation, quota/rate-limit/spend-cap, support/retry/abuse, eval/QA/safety enforcement, crawler runtime checks, observability/backup/load/post-deploy-smoke, and legal/support external-user visibility with staging evidence",
        "keeps Private Beta/Staging aggregate no-go only for production-like object storage retention/cleanup",
        "Production provider-or-comp-only cannot close from provider abstractions",
        "Production paid billing lifecycle cannot close from mock checkout",
        "Production backup/rollback/incident readiness cannot close from runbooks or release templates alone",
        "Production legal/support policy cannot close from web page artifacts alone",
        "Combined split release checks must cite every concrete split evidence file",
        "Private Beta/Staging object storage pass evidence must cite both signed URL and retention/cleanup staging files",
        "Private Beta/Staging legal/support pass evidence must cite both legal-page and support-contact staging files",
        "Production provider mode pass evidence must cite both launch-mode and public-claims production files",
        "Production billing pass evidence must cite both checkout/subscription and refund/credit/webhook production files",
        "Production backup/rollback pass evidence must cite both backup/restore and rollback/incident/post-deploy production files",
        "Production legal/support pass evidence must cite both public legal policy and support/billing policy production files",
        "exact per-workflow API, Playwright, and export ZIP runtime evidence files under `ops/evidence/local_alpha/`",
        "one generic local smoke artifact or directory-level reference cannot close the aggregate Local Alpha runtime check",
        "Local backup/restore, load, observability, or smoke evidence under `ops/evidence/backup-restore/`, `ops/evidence/observability/`, or other non-staging/non-production paths cannot close Private Beta/Staging or Production launch gates",
        "staging gates require `environment=staging` evidence under `ops/evidence/staging/`, and production gates require `environment=production` evidence under `ops/evidence/production/`",
        "A top-level gate checklist item may close only after its aggregate runtime checklist item is closed",
        "if those are all true, the gate checklist item must be updated in the same change",
        "Local Alpha remains open until four workflow API/Playwright smokes",
        "Production Launch cannot clear `ci_staging_gates_not_passed` or pass backup/rollback/post-deploy evidence until both",
        "Production backup/rollback/post-deploy pass evidence must cite both upstream gate fixtures",
        "must not appear inside release-gate fixtures or runtime evidence `gate_impact.checklist_items`",
        "Blocked split runtime/deployment checks must name every exact split evidence file still required for closure",
        "must also state whether each exact split evidence file is already present/passed or still absent/missing",
        "Blocked split runtime/deployment checks that mention an existing split evidence file must validate that file against its owning checked checklist row",
        "Open split checklist rows cannot remain open after their exact validator-owned evidence file becomes passable",
        "a broad `ops/evidence/staging/` or `ops/evidence/production/` placeholder cannot preserve a launch blocker",
        "Existing half-split evidence can only close its own concrete subitem",
        "the combined check remains blocked until every required split file exists",
        "Checked split evidence checklist rows require their validator-owned exact file to exist",
        "A combined split release-gate check cannot pass while any exact split evidence file is missing/non-passable",
        "A combined split release-gate check cannot remain blocked after every exact split evidence file is passable",
        "except Production backup/rollback/post-deploy",
        "Checked partial split rows may preserve the combined release-gate blocker only when the row is explicitly partial",
        "remaining_blockers` must exactly match the current blocked/failing check IDs",
        "Do-Not-Launch Conditions 全部为 false。` remains open while any release-gate evidence fixture has `is_present: true`",
        "Do-Not-Launch Conditions 全部为 false。` may close only when all four release gate fixtures have no active Do-Not-Launch conditions",
        "Do-Not-Launch Conditions 全部为 false。` also requires all four release gate `gate_decision.status` values to be `go`",
        "a global close with any fixture-level `no_go` decision is invalid",
        "Release gate fixture IDs are closed-world",
        "Release gate fixture files are closed-world",
        "Release gate fixture identities are closed-world",
        "gate_local_alpha_fixture_baseline",
        "gate_ci_draft_blocked",
        "gate_private_beta_staging_blocked",
        "gate_production_launch_blocked",
        "copied, renamed, or extra release-gate fixtures cannot contribute to gate closure",
        "`schema_version` must remain `stage0.rev2`",
        "`gate` must match the filename's canonical gate",
        "`provenance.created_by_lane` must remain `lane6`",
    ]:
        require(token in text, f"blueprint release gate closure policy missing token: {token}")

    required_ci_tokens = [
        "playwright-smoke",
        "DRY_RUN=1 scripts/playwright_smoke.sh",
        "docker build --tag ghcr.io/alphane-ai/zenart-${{ matrix.image.name }}:${{ github.sha }}",
        "DRY_RUN=1 scripts/docker_build_smoke.sh",
    ]
    for token in required_ci_tokens:
        require(token in ci_text, f"CI draft evidence missing launch-readiness token: {token}")

    artifact_ids = {item["artifact_id"] for item in ci_evidence["artifact_checks"]}
    require("playwright_smoke_draft" in artifact_ids, "CI evidence must include Playwright smoke draft artifact")
    require("docker_and_staging_smoke_draft" in artifact_ids, "CI evidence must include Docker/staging smoke draft artifact")
    require(
        ci_evidence["release_gate_effect"]["ci_gate_status"] == "blocked",
        "CI draft evidence must not mark CI Gate passable",
    )

    policy = release_ops["checklist_policy"]
    for key in [
        "ci_playwright_smoke_remains_open",
        "ci_docker_image_build_remains_open",
        "staging_deploy_remains_open",
        "staging_smoke_remains_open",
    ]:
        require(policy.get(key) is True, f"release ops policy must keep {key} true")
    require(
        policy.get("release_notes_template_complete") is True,
        "release ops policy must mark the release notes template complete",
    )
    require(
        policy.get("current_release_decision") == "no-go_until_runtime_release_evidence_and_gate_fixtures_pass",
        "release ops policy must keep the current release decision no-go",
    )
    post_deploy_contract = release_ops["post_deploy_smoke_go_no_go_contract"]
    require(
        post_deploy_contract["script"] == "scripts/staging_smoke.sh",
        "post-deploy smoke contract must cite scripts/staging_smoke.sh",
    )
    require(
        {"release_evidence", "release_gate_fixtures", "go_no_go"}
        <= set(post_deploy_contract["report_summary_fields"]),
        "post-deploy smoke contract must require release evidence, release gate fixtures, and go/no-go summary fields",
    )
    require(
        {"go_no_go.decision_inputs", "go_no_go.gate_fixtures_clear"}
        <= set(post_deploy_contract["report_summary_fields"]),
        "post-deploy smoke contract must expose explicit go/no-go decision inputs",
    )
    require(
        "required release evidence is absent" in post_deploy_contract["gate_policy"]
        and "production do-not-launch fixtures are present" in post_deploy_contract["gate_policy"],
        "post-deploy smoke gate policy must keep runtime smoke blocked until evidence and do-not-launch blockers clear",
    )
    require(
        "go/no-go decision inputs are incomplete" in post_deploy_contract["gate_policy"],
        "post-deploy smoke gate policy must mention incomplete decision inputs",
    )
    required_release_slots = set(post_deploy_contract["required_release_evidence_slots"])
    require(
        {
            "release_sha",
            "release_notes_path",
            "image_refs",
            "migration_evidence",
            "config_diff_evidence",
            "observability_evidence",
            "backup_restore_evidence",
            "load_evidence",
            "rollback_evidence",
            "security_scan_evidence",
        }
        <= required_release_slots,
        "post-deploy smoke contract must require every release evidence slot",
    )
    local_verification = post_deploy_contract["local_evidence_verification"]
    require(
        "Identity" in local_verification["release_notes_path"]
        and "Go/No-Go" in local_verification["release_notes_path"],
        "release notes verification must require the Rev2 release sections",
    )
    require(
        "release_gate_check_id=staging_object_storage_signed_downloads"
        in local_verification["object_storage_signed_url_evidence"]
        and "cross-tenant denial" in local_verification["object_storage_signed_url_evidence"],
        "object-storage signed URL release verification must require split staging signed URL evidence",
    )
    require(
        "release_gate_check_id=staging_object_storage_signed_downloads"
        in local_verification["object_storage_retention_cleanup_evidence"]
        and "expired export cleanup" in local_verification["object_storage_retention_cleanup_evidence"]
        and "orphan cleanup" in local_verification["object_storage_retention_cleanup_evidence"],
        "object-storage retention release verification must require split staging cleanup evidence",
    )
    require(
        "release_gate_check_id=staging_legal_external_user_pages"
        in local_verification["legal_support_external_user_visibility_evidence"]
        and "legal-pages-external-user.json" in local_verification["legal_support_external_user_visibility_evidence"]
        and "support-contact-external-user.json" in local_verification["legal_support_external_user_visibility_evidence"]
        and "instead of source-file presence" in local_verification["legal_support_external_user_visibility_evidence"],
        "legal/support release verification must require split deployed external-user visibility evidence",
    )
    require(
        "backend, web, and admin" in local_verification["image_refs"]
        and "RELEASE_SHA" in local_verification["image_refs"],
        "image ref verification must require SHA-tagged backend/web/admin images",
    )

    signals = {item["name"]: item for item in observability["signals"]}
    runtime_open_signals = {
        "request_id_propagation",
        "structured_json_logs",
        "opentelemetry_traces",
        "backend_worker_crawler_metrics",
    }
    for signal in runtime_open_signals:
        require(signal in signals, f"observability evidence missing signal {signal}")
        require(
            signals[signal]["runtime_status"]
            in {
                "local_healthz_contract_validated_staging_runtime_open",
                "backend_local_contract_validated_staging_runtime_open",
                "backend_local_contract_validated_staging_log_capture_open",
                "backend_local_metrics_endpoint_validated_worker_crawler_staging_open",
                "backend_runtime_worker_crawler_definitions_validated_staging_capture_open",
                "definition_validated_recovery_log_request_id_open",
                "definition_validated",
                "staging_validated",
                "open",
            },
            f"observability signal {signal} must be locally open or staging validated without claiming production pass",
        )
        require(
            "production_gate" in signals[signal] or "private_beta_gate" in signals[signal],
            f"observability signal {signal} must describe remaining launch gate evidence",
        )

    require(
        dashboard["status"] == "definition_ready_runtime_evidence_open",
        "dashboard definition artifact must keep broader observability runtime gate open",
    )
    require(
        alerts["status"] == "definition_ready_runtime_evidence_open",
        "alert definition artifact must keep broader observability runtime gate open",
    )


def validate_generated_openapi_clients() -> None:
    openapi_text = OPENAPI.read_text(encoding="utf-8")
    expected_digest = hashlib.sha256(openapi_text.encode("utf-8")).hexdigest()
    operation_rbac = {
        operation_id: rbac
        for operation_id, operation_body in re.findall(
            r"operationId: ([A-Za-z0-9_]+)\n(?P<body>(?:^      .+\n|^        .+\n|^          .+\n|^            .+\n|^              .+\n|^                .+\n|^                  .+\n)+)",
            openapi_text,
            flags=re.MULTILINE,
        )
        for rbac in re.findall(r"x-rbac: (user|admin)", operation_body)
    }
    require(operation_rbac, "OpenAPI client validation could not read operation RBAC metadata")
    expected_operations = {
        "web": {operation_id for operation_id, rbac in operation_rbac.items() if rbac == "user"},
        "admin": set(operation_rbac),
    }

    for audience, target in {
        "web": ROOT / "web" / "lib" / "generated" / "zenart-api.ts",
        "admin": ROOT / "admin" / "lib" / "generated" / "zenart-api.ts",
    }.items():
        require(target.exists(), f"missing generated client: {target.relative_to(ROOT)}")
        text = target.read_text(encoding="utf-8")
        require("Generated by scripts/generate_openapi_clients.py" in text, f"{target.relative_to(ROOT)} must be generated")
        require(
            f'OPENAPI_SHA256 = "{expected_digest}"' in text,
            f"{target.relative_to(ROOT)} must carry current OpenAPI SHA256 digest",
        )
        require(
            f'API_AUDIENCE = "{audience}"' in text,
            f"{target.relative_to(ROOT)} must declare {audience} API audience",
        )
        require("ErrorEnvelope" in text, f"{target.relative_to(ROOT)} missing ErrorEnvelope")
        require("TaskStatus" in text, f"{target.relative_to(ROOT)} missing TaskStatus")
        require("errorEnvelope: true" in text, f"{target.relative_to(ROOT)} missing per-operation error envelope metadata")
        generated_operations = set(re.findall(r"^  ([A-Za-z0-9_]+): \{ method:", text, flags=re.MULTILINE))
        require(
            generated_operations == expected_operations[audience],
            f"{target.relative_to(ROOT)} operation audience mismatch: missing "
            f"{sorted(expected_operations[audience] - generated_operations)}, extra "
            f"{sorted(generated_operations - expected_operations[audience])}",
        )

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
    for path in [
        CI_DRAFT,
        CI_INSTALLATION,
        ENVIRONMENT_EVIDENCE,
        DRILL_PLAN_EVIDENCE,
        OBSERVABILITY_EVIDENCE,
        RELEASE_OPS_EVIDENCE,
        ROOT / "ops" / "ci" / "playwright-smoke.spec.ts",
        ROOT / "ops" / "release" / "staging_deploy.md",
        ROOT / "ops" / "release" / "release_notes_template.md",
        ROOT / "scripts" / "playwright_smoke.sh",
        ROOT / "scripts" / "docker_build_smoke.sh",
        ROOT / "scripts" / "staging_smoke.sh",
        ROOT / "scripts" / "observability_smoke.sh",
        ROOT / "scripts" / "staging_observability_backup_load_smoke.sh",
        ROOT / "scripts" / "staging_object_storage_signed_url_smoke.sh",
        STAGING_LEGAL_SUPPORT_VISIBILITY_SCRIPT,
        ROOT / "scripts" / "security_scan_smoke.sh",
    ]:
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
        "playwright-smoke",
        "DRY_RUN=1 scripts/playwright_smoke.sh",
        "bash -n scripts/docker_build_smoke.sh",
        "bash -n scripts/staging_smoke.sh",
        "bash -n scripts/observability_smoke.sh",
        "bash -n scripts/staging_object_storage_signed_url_smoke.sh",
        "bash -n scripts/staging_legal_support_visibility_smoke.sh",
        "DRY_RUN=1 scripts/staging_legal_support_visibility_smoke.sh",
        "bash -n scripts/security_scan_smoke.sh",
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
        env["ci_draft"]["path"] == CI_DRAFT_REL,
        "environment evidence must point at ops/ci CI draft",
    )
    open_items = {item["id"]: item for item in env["open_items"]}
    require(
        open_items.get("install_github_actions_workflow", {}).get("status") == "blocked_by_token_scope",
        "workflow installation must remain blocked_by_token_scope",
    )
    require("playwright_smoke" in open_items, "environment evidence must keep Playwright smoke open")
    require("docker_image_build_runtime" in open_items, "environment evidence must keep Docker image runtime evidence open")

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
    require(
        drill["load"].get("script_contract_status") == "validated",
        "drill plan must record validated load smoke script coverage",
    )
    staging_obl = drill.get("staging_observability_backup_load_preflight", {})
    require(
        staging_obl.get("script") == "scripts/staging_observability_backup_load_smoke.sh",
        "drill plan must cite staging observability/backup/load preflight script",
    )
    require(
        staging_obl.get("script_contract_status") in {
            "validated_missing_evidence_blocks_by_default",
            "validated_with_complete_staging_evidence",
        },
        "staging observability/backup/load preflight must document either default-blocking or completed staging evidence",
    )
    require(
        {
            "request_id_propagation",
            "structured_json_logs",
            "opentelemetry_traces",
            "backend_worker_crawler_metrics",
            "dashboard_import",
            "alert_routes",
        }
        <= set(staging_obl.get("required_observability_entries", [])),
        "staging observability/backup/load preflight missing observability entries",
    )
    require(
        {"postgres_restore", "object_restore"} <= set(staging_obl.get("required_restore_entries", [])),
        "staging observability/backup/load preflight missing restore entries",
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
        <= set(staging_obl.get("required_load_entries", [])),
        "staging observability/backup/load preflight missing load entries",
    )
    require(
        {
            "backend_health",
            "web",
            "admin",
            "auth_boundary",
            "worker_task",
            "export_package",
            "signed_download",
            "crawler_admin",
            "quota_rate_limit",
            "observability",
        }
        <= set(staging_obl.get("required_post_deploy_smoke_entries", [])),
        "staging observability/backup/load preflight missing post-deploy smoke entries",
    )
    require(
        "open until the preflight passes with real staging evidence" in staging_obl.get("private_beta_gate", "")
        or "staging_observability_backup_load check can close" in staging_obl.get("private_beta_gate", ""),
        "staging observability/backup/load preflight must describe private beta gate state",
    )
    require(
        staging_obl.get("latest_preflight_evidence")
        == rel(STAGING_OBSERVABILITY_BACKUP_LOAD_PREFLIGHT_EVIDENCE),
        "drill plan must cite the latest staging observability/backup/load preflight evidence",
    )
    runtime_status = staging_obl.get("runtime_status", "")
    require(
        (
            "observability input verifies" in runtime_status
            and "backup/restore, load, and post-deploy smoke inputs are absent" in runtime_status
        )
        or "preflight passed with staging observability" in runtime_status,
        "drill plan must record the latest staging observability/backup/load preflight state",
    )
    require(
        "actual temporary database restore verifies restored table count" in drill["backup_restore"]["checks"],
        "drill plan must require actual temporary Postgres restore verification",
    )
    require(
        "postgres_restore_verify" in drill["backup_restore"]["report_fields"],
        "drill plan must record Postgres restore verification report field",
    )

    observability = load_json(OBSERVABILITY_EVIDENCE)
    require(
        observability["blueprint_source"] == "Docs/stage0_blueprint_rev2.md",
        "observability evidence must cite Rev2",
    )
    require(observability["created_by_lane"] == "lane5", "observability evidence must be lane5-owned")
    require(
        observability["status"]
        in {
            "definition_only",
            "definition_ready_runtime_evidence_open",
            "local_runtime_hooks_validated_staging_runtime_evidence_open",
            "staging_observability_runtime_validated_restore_load_gate_open",
        },
        "observability evidence must not claim restore/load or production runtime completion",
    )
    require(
        observability.get("dashboard_definition") == "ops/observability/dashboards/stage0_rev2_overview.json",
        "observability evidence must cite dashboard definition",
    )
    require(
        observability.get("alert_definition") == "ops/observability/alerts/stage0_rev2_alerts.json",
        "observability evidence must cite alert definition",
    )
    required_signals = {
        "request_id_propagation",
        "structured_json_logs",
        "opentelemetry_traces",
        "backend_worker_crawler_metrics",
        "frontend_error_reporting",
        "dashboards",
        "alerts",
    }
    signals = {item["name"]: item for item in observability["signals"]}
    require(required_signals <= signals.keys(), "observability evidence missing required Rev2 signals")
    require(
        observability.get("smoke_script") == "scripts/observability_smoke.sh",
        "observability evidence must cite observability smoke script",
    )
    for signal_name in required_signals:
        require(
            signals[signal_name]["runtime_status"]
            in {
                "local_healthz_contract_validated_staging_runtime_open",
                "backend_local_contract_validated_staging_runtime_open",
                "backend_local_contract_validated_staging_log_capture_open",
                "backend_local_metrics_endpoint_validated_worker_crawler_staging_open",
                "backend_runtime_worker_crawler_definitions_validated_staging_capture_open",
                "definition_validated_recovery_log_request_id_open",
                "definition_validated",
                "staging_validated",
                "open",
            },
            f"observability signal {signal_name} must be open, contract_validated, or staging_validated",
        )
    slo_thresholds = observability["slo_thresholds"]
    require(slo_thresholds["api_p95_latency_ms"] == 500, "observability evidence must define API p95 threshold")
    require(slo_thresholds["queue_delay_p95_seconds"] == 60, "observability evidence must define queue p95 threshold")
    require(slo_thresholds["export_duration_p95_seconds"] == 120, "observability evidence must define export p95 threshold")
    require(slo_thresholds["ui_load_p95_seconds"] == 3, "observability evidence must define UI p95 threshold")
    require(
        slo_thresholds["error_rate_5xx_percent_30m"] == 1,
        "observability evidence must define 5xx error-rate threshold",
    )

    dashboard = load_json(OBSERVABILITY_DASHBOARD)
    require(dashboard["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "dashboard must cite Rev2")
    require(dashboard["created_by_lane"] == "lane5", "dashboard must be lane5-owned")
    require(
        dashboard["status"] == "definition_ready_runtime_evidence_open",
        "dashboard must keep runtime evidence gate open",
    )
    required_dashboard_panels = {
        "api_latency_p95",
        "api_5xx_rate",
        "worker_queue_delay_p95",
        "generation_duration_p95",
        "export_duration_p95",
        "provider_errors",
        "quota_contention",
        "crawler_throttle",
        "object_storage_errors",
        "billing_and_subscription_failures",
        "safety_and_qa_blocks",
        "admin_failures",
        "frontend_error_rate",
    }
    dashboard_panels = {panel["panel_id"]: panel for panel in dashboard["panels"]}
    require(required_dashboard_panels <= dashboard_panels.keys(), "dashboard missing required Rev2 panels")
    require(
        dashboard_panels["api_latency_p95"]["slo_threshold"]["value"] == slo_thresholds["api_p95_latency_ms"],
        "dashboard API latency threshold must match observability evidence",
    )
    require(
        dashboard_panels["worker_queue_delay_p95"]["slo_threshold"]["value"]
        == slo_thresholds["queue_delay_p95_seconds"],
        "dashboard queue delay threshold must match observability evidence",
    )
    require(
        dashboard_panels["export_duration_p95"]["slo_threshold"]["value"]
        == slo_thresholds["export_duration_p95_seconds"],
        "dashboard export duration threshold must match observability evidence",
    )
    require(
        "open_until_dashboard_is_imported" in dashboard["private_beta_gate"],
        "dashboard must keep private beta gate open until imported runtime evidence exists",
    )

    alerts = load_json(OBSERVABILITY_ALERTS)
    require(alerts["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "alerts must cite Rev2")
    require(alerts["created_by_lane"] == "lane5", "alerts must be lane5-owned")
    require(alerts["status"] == "definition_ready_runtime_evidence_open", "alerts must keep runtime evidence gate open")
    required_alerts = {
        "api_5xx_rate_high",
        "api_latency_p95_high",
        "worker_queue_delay_high",
        "export_duration_high",
        "provider_error_rate_high",
        "object_storage_errors_present",
        "quota_contention_high",
        "crawler_governance_failure",
        "safety_critical_block",
        "admin_rbac_denial_spike",
        "frontend_error_rate_high",
    }
    alert_defs = {alert["alert_id"]: alert for alert in alerts["alerts"]}
    require(required_alerts <= alert_defs.keys(), "alerts missing required Rev2 alert rules")
    require(
        alert_defs["api_5xx_rate_high"]["condition"] == "> 1",
        "API 5xx alert must match Rev2 1 percent threshold",
    )
    require(
        alert_defs["api_latency_p95_high"]["condition"] == "> 500",
        "API latency alert must match Rev2 500 ms threshold",
    )
    require(
        alert_defs["worker_queue_delay_high"]["condition"] == "> 60",
        "worker queue alert must match Rev2 60 second threshold",
    )
    require(
        alert_defs["export_duration_high"]["condition"] == "> 120",
        "export duration alert must match Rev2 120 second threshold",
    )
    require(
        "open_until_alert_routes" in alerts["private_beta_gate"],
        "alerts must keep private beta gate open until route and threshold evidence exists",
    )

    release_ops = load_json(RELEASE_OPS_EVIDENCE)
    require(release_ops["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "release ops evidence must cite Rev2")
    require(release_ops["created_by_lane"] == "lane5", "release ops evidence must be lane5-owned")
    scripts = release_ops["scripts"]
    for key, script_path in {
        "playwright_smoke": "scripts/playwright_smoke.sh",
        "docker_build_smoke": "scripts/docker_build_smoke.sh",
        "staging_smoke": "scripts/staging_smoke.sh",
        "observability_smoke": "scripts/observability_smoke.sh",
        "staging_observability_backup_load_smoke": "scripts/staging_observability_backup_load_smoke.sh",
        "staging_object_storage_signed_url_smoke": "scripts/staging_object_storage_signed_url_smoke.sh",
        "staging_legal_support_visibility_smoke": "scripts/staging_legal_support_visibility_smoke.sh",
        "security_scan_smoke": "scripts/security_scan_smoke.sh",
    }.items():
        require(key in scripts, f"release ops evidence missing {key}")
        require(scripts[key]["script"] == script_path, f"release ops evidence {key} must cite {script_path}")
        require(repo_path(script_path).exists(), f"release ops evidence script missing: {script_path}")
    staging_obl = scripts["staging_observability_backup_load_smoke"]
    require(
        staging_obl.get("latest_preflight_evidence")
        == rel(STAGING_OBSERVABILITY_BACKUP_LOAD_PREFLIGHT_EVIDENCE),
        "release ops evidence must cite the latest staging observability/backup/load preflight evidence",
    )
    runtime_status = staging_obl.get("runtime_status", "")
    require(
        (
            "latest preflight verifies staging observability" in runtime_status
            and "blocked on missing backup/restore, load, and post-deploy smoke evidence" in runtime_status
        )
        or "passes the private beta staging_observability_backup_load evidence bundle" in runtime_status,
        "release ops evidence must record the latest staging observability/backup/load preflight state",
    )
    object_storage_signed = scripts["staging_object_storage_signed_url_smoke"]
    require(
        object_storage_signed.get("latest_signed_url_evidence") == rel(STAGING_OBJECT_STORAGE_SIGNED_URL_EVIDENCE),
        "release ops evidence must cite the latest staging object-storage signed URL evidence",
    )
    require(
        "tenant-scoped signed download" in object_storage_signed.get("runtime_status", "")
        and "retention cleanup blockers" in object_storage_signed.get("runtime_status", ""),
        "release ops evidence must preserve object-storage signed URL and retention cleanup split",
    )
    legal_support_visibility = scripts["staging_legal_support_visibility_smoke"]
    require(
        "Terms" in legal_support_visibility.get("runtime_status", "")
        and "support contact" in legal_support_visibility.get("runtime_status", "")
        and "dry-run evidence remains blocked" in legal_support_visibility.get("runtime_status", "")
        and "passes deployed staging external-user HTTP probes" in legal_support_visibility.get("runtime_status", ""),
        "release ops evidence must record legal/support staging visibility runtime requirements",
    )
    require(
        "closed for legal/support visibility after ops/evidence/staging legal/support visibility evidence passes"
        in legal_support_visibility.get("private_beta_gate", ""),
        "release ops evidence must record legal/support visibility closure and remaining object-storage blocker",
    )
    policy = release_ops["checklist_policy"]
    for key in [
        "ci_playwright_smoke_remains_open",
        "ci_docker_image_build_remains_open",
        "staging_deploy_remains_open",
        "staging_smoke_remains_open",
    ]:
        require(policy.get(key) is True, f"release ops evidence must keep {key} true")
    require(
        policy.get("release_notes_template_complete") is True,
        "release ops evidence must mark release_notes_template_complete true",
    )
    require(
        policy.get("current_release_decision") == "no-go_until_runtime_release_evidence_and_gate_fixtures_pass",
        "release ops evidence must keep current release decision no-go",
    )
    release_docs = release_ops["release_docs"]
    require(
        release_docs.get("current_no_go_release_notes") == "ops/release/stage0_rev2_current_no_go_release_notes.md",
        "release ops evidence must cite the current no-go release notes",
    )
    require(
        repo_path(release_docs["current_no_go_release_notes"]).exists(),
        "current no-go release notes file must exist",
    )


def main() -> int:
    checks = [
        validate_json_files,
        validate_schema_fixture_contracts,
        validate_provenance,
        validate_ops_ci_artifact_evidence,
        validate_workflows,
        validate_workflow_acceptance_split_contracts,
        validate_eval_suite,
        validate_eval_results,
        validate_qa_and_safety,
        validate_crawler_feedback_abuse,
        validate_abuse_evidence_split_contracts,
        validate_staging_auth_rbac_tenant_audit_evidence,
        validate_staging_brief_upload_confirmation_evidence,
        validate_staging_object_storage_signed_url_evidence,
        validate_staging_quota_rate_limit_spend_cap_evidence,
        validate_staging_support_retry_abuse_evidence,
        validate_staging_eval_qa_safety_evidence,
        validate_staging_dashboard_runtime_evidence,
        validate_staging_alert_runtime_evidence,
        validate_staging_backend_worker_crawler_metrics_evidence,
        validate_staging_observability_telemetry_evidence,
        validate_staging_observability_runtime_evidence,
        validate_staging_observability_backup_load_preflight_evidence,
        validate_production_skill_release_eval_canary_evidence,
        validate_production_abuse_throttle_hold_evidence,
        validate_production_activation_review_audit_evidence,
        validate_production_security_launch_checks_evidence,
        validate_production_backup_rollback_incident_admin_evidence,
        validate_analytics_taxonomy,
        validate_local_alpha_presence,
        validate_release_gate_evidence,
        validate_readme_and_architecture_contract,
        validate_blueprint_checklist,
        validate_database_schema_artifacts,
        validate_openapi_contract,
        validate_openapi_rev2_domain_contracts,
        validate_eval_result_contract,
        validate_eval_storage_contract,
        validate_activation_gate_contract,
        validate_trace_completeness_contract,
        validate_trace_export_gate_matrix_contract,
        validate_safety_enforcement_contract,
        validate_qa_result_coverage_contract,
        validate_qa_enforcement_matrix_contract,
        validate_export_override_contract,
        validate_task_schema_compatibility_contract,
        validate_blueprint_evidence_backfill_contracts,
        validate_launch_readiness_split_contracts,
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
