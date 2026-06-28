#!/usr/bin/env python3
"""Validate Stage 1 AD-9 skill/eval release API/UI contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "skill_eval_release" / "local_contract.json"
MIGRATION = ROOT / "backend" / "migrations" / "0002_stage0_rev2_domains.sql"
STAGE0_CODE = ROOT / "backend" / "internal" / "stage0" / "services.go"
STAGE0_TESTS = ROOT / "backend" / "internal" / "stage0" / "services_test.go"
SERVER_CODE = ROOT / "backend" / "internal" / "server" / "server.go"
SERVER_TESTS = ROOT / "backend" / "internal" / "server" / "server_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
ADMIN_GENERATED = ROOT / "admin" / "lib" / "generated" / "zenart-api.ts"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_SKILLS_PAGE = ROOT / "admin" / "app" / "skills" / "page.tsx"
ADMIN_RELEASES_PAGE = ROOT / "admin" / "app" / "skills" / "releases" / "page.tsx"
ADMIN_TESTS = ROOT / "admin" / "tests" / "admin-data.test.mjs"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class SkillEvalReleaseContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SkillEvalReleaseContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise SkillEvalReleaseContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.skill_eval_release.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "skill_eval_release_admin_contract", "fixture kind mismatch")
    require({"AD-9", "QA-6", "QA-7", "VF-5"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    for route in (
        "GET /api/admin/v1/skills",
        "GET /api/admin/v1/skills/{skill_id}/versions",
        "GET /api/admin/v1/eval/results",
        "GET /api/admin/v1/eval/results/{result_id}/artifact",
    ):
        require(route in data.get("required_backend_routes", []), f"fixture missing route {route}")
    permissions = data.get("required_permissions")
    require(isinstance(permissions, dict), "fixture required_permissions must be object")
    for key in ("read", "eval_results", "artifact"):
        require(permissions.get(key) == "skill_release:admin", f"fixture permission {key} mismatch")
    non_launch = data.get("non_launch_status")
    require(isinstance(non_launch, dict), "fixture non_launch_status must be object")
    require(non_launch.get("local_contract") == "pass", "local contract status mismatch")
    require(non_launch.get("staging_evidence") == "open", "staging evidence must remain open")
    require(non_launch.get("production_evidence") == "open", "production evidence must remain open")
    require(non_launch.get("can_clear_skill_release_eval_canary_gate") is False, "local contract must not clear production skill gate")
    for ref in data.get("required_files", []):
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")


def validate_backend() -> None:
    require_text(
        MIGRATION,
        (
            "CREATE TABLE IF NOT EXISTS skills",
            "CREATE TABLE IF NOT EXISTS skill_versions",
            "CREATE TABLE IF NOT EXISTS skill_release_channels",
            "CREATE TABLE IF NOT EXISTS skill_usage_stats",
            "CREATE TABLE IF NOT EXISTS eval_results",
            "tenant_id text NOT NULL REFERENCES tenants(id)",
            "summary jsonb NOT NULL",
            "runner_sha256 text NOT NULL",
            "idx_eval_results_tenant_suite_subject_created_at",
            "idx_eval_results_subject_status_completed_at",
        ),
    )
    require_text(
        STAGE0_CODE,
        (
            "type Skill struct",
            "type SkillVersion struct",
            "type SkillVersionReleaseGate struct",
            "type EvalResult struct",
            "type EvalResultArtifact struct",
            "func (r Repository) ListSkills",
            "func (r Repository) ListSkillVersions",
            "func (r Repository) ListEvalResults",
            "func (r Repository) GetEvalResultArtifact",
            "(s.tenant_id IS NULL OR s.tenant_id = $1)",
            "LEFT JOIN LATERAL",
            "er.tenant_id = $1",
            "read_without_eval_rerun",
            "security.RedactMap",
            "security.RedactValue",
            "direct_object_access_allowed",
            "audit_access_required",
            "max_expires_in_seconds",
            "15 * time.Minute",
        ),
    )
    require_text(
        SERVER_CODE,
        (
            'GET /api/admin/v1/skills',
            'GET /api/admin/v1/skills/{skill_id}/versions',
            'GET /api/admin/v1/eval/results',
            'GET /api/admin/v1/eval/results/{result_id}/artifact',
            "auth.PermissionSkillReleaseAdmin",
            "func (s *Server) listSkills",
            "func (s *Server) listSkillVersions",
            "func (s *Server) listEvalResults",
            "func (s *Server) getEvalResultArtifact",
            "PrincipalFromContext",
            "parseOptionalRFC3339",
            "parseBoolQuery",
        ),
    )
    require_text(
        STAGE0_TESTS,
        (
            "TestListSkillsUsesTenantOrGlobalScope",
            "TestListSkillVersionsBuildsReleaseGateFromLatestEval",
            "TestListEvalResultsFiltersLatestAndRedactsSummary",
            "TestGetEvalResultArtifactReturnsSafeAdminRetrievalMetadata",
            "DISTINCT ON",
            "direct_object_access_allowed",
        ),
    )
    require_text(
        SERVER_TESTS,
        (
            "TestAdminSkillReleaseRoutesRequireReviewerPermission",
            "TestAdminSkillsUsesPrincipalTenant",
            "TestAdminSkillVersionsUsesPrincipalTenantAndProjectsReleaseGate",
            "TestAdminEvalResultsUsesPrincipalTenantAndSafeProjection",
            "TestAdminEvalResultArtifactUsesPrincipalTenantAndSafeAdminURL",
            "skill_release:admin",
            "read_without_eval_rerun",
        ),
    )


def validate_openapi_admin() -> None:
    require_text(
        OPENAPI,
        (
            "/skills:",
            "operationId: listSkills",
            "/skills/{skill_id}/versions:",
            "operationId: listSkillVersions",
            "/eval/results:",
            "operationId: listEvalResults",
            "/eval/results/{result_id}/artifact:",
            "operationId: getEvalResultArtifact",
            "SkillVersion:",
            "release_gate:",
            "EvalResult:",
            "EvalResultArtifact:",
            "read_without_eval_rerun",
            "direct_object_access_allowed",
            "audit_required",
        ),
    )
    require_text(
        ADMIN_GENERATED,
        (
            'listSkills: { method: "GET", path: "/skills", rbac: "admin"',
            'listSkillVersions: { method: "GET", path: "/skills/{skill_id}/versions", rbac: "admin"',
            'listEvalResults: { method: "GET", path: "/eval/results", rbac: "admin"',
            'getEvalResultArtifact: { method: "GET", path: "/eval/results/{result_id}/artifact", rbac: "admin"',
        ),
    )
    require_text(
        ADMIN_TYPES,
        (
            'source?: "api" | "fixture"',
            "evalSuiteId?: string | null",
            "releaseGate?:",
            "lastEvalResultId?: string | null",
            "evalContractComplete: boolean",
            "criticalSafetyRegressions: number",
            "export type EvalResult",
            "artifactRef: string",
        ),
    )
    require_text(
        ADMIN_API,
        (
            "getSkills(): Promise<Skill[]>",
            "getSkillVersions(): Promise<SkillVersion[]>",
            "getEvalResults(): Promise<EvalResult[]>",
            "/api/admin/v1/skills?page_size=100",
            "/api/admin/v1/skills/${encodeURIComponent(skill.id)}/versions?page_size=100",
            "/api/admin/v1/eval/results?page_size=100&latest_only=true",
            "mapSkillAPI",
            "mapSkillVersionAPI",
            "mapEvalResultAPI",
            "evalResultFixtures",
            'source: "api"',
            'source: "fixture"',
            "getEvalResultArtifact:",
        ),
    )
    require_text(
        ADMIN_SKILLS_PAGE,
        (
            "Skill Registry",
            "live api",
            "fixture fallback",
            "Source",
            "getSkills",
        ),
    )
    releases = require_text(
        ADMIN_RELEASES_PAGE,
        (
            "Skill Version Review",
            "Eval Result Store",
            "API Contract Anchors",
            "listSkills",
            "listSkillVersions",
            "listEvalResults",
            "getEvalResultArtifact",
            "skill_release:admin",
            "Release Gate",
            "Last Eval",
            "live api",
            "fixture fallback",
        ),
    )
    forbidden_mutations = (
        "Start Canary",
        "Rollback Now",
        "Activate Release",
        "Pause Release",
        "createSkillRelease",
        "updateSkillRelease",
    )
    for token in forbidden_mutations:
        require(token not in releases, f"release page must stay read-only; found {token!r}")
    require_text(
        ADMIN_TESTS,
        (
            "Skill Release RBAC Evidence",
            "Production Skill Release Runtime Evidence",
        ),
    )


def validate_inventory() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "VF-5c",
            "scripts/validate_stage1_skill_eval_release_contract.py",
            "AD-9",
            "GET /api/admin/v1/skills",
            "GET /api/admin/v1/eval/results",
            "skill_release:admin",
        ),
    )


def validate_no_secret_material() -> None:
    for path in (FIXTURE, STAGE0_CODE, SERVER_CODE, OPENAPI, ADMIN_API, ADMIN_SKILLS_PAGE, ADMIN_RELEASES_PAGE):
        text = read_text(path)
        require(not RAW_SECRET_RE.search(text), f"{path.relative_to(ROOT)} contains raw secret-looking material")


def main() -> int:
    try:
        validate_fixture()
        validate_backend()
        validate_openapi_admin()
        validate_inventory()
        validate_no_secret_material()
    except SkillEvalReleaseContractError as exc:
        print(f"stage1 skill eval release contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 skill eval release contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
