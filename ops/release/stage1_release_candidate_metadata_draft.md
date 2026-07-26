# Stage 1 Release Candidate Metadata Draft

Authoritative source: `Docs/Stage1_20260621_blueprint.md`.

This draft is generated from repository state only. It does not close CI,
staging, production, or Do-Not-Launch gates.

## Identity

- Release SHA: `b885b7ac1c75cad256d774a1fed82008eea4aecf`
- Release tag: `n/a`
- Owner: `release-owner-unassigned`
- Reviewer: `reviewer-unassigned`
- Environment: `staging metadata draft`
- Date: `2026-06-28`
- Worktree state: `dirty`

## Scope

- User-facing changes: Stage 1 workspace, canvas, batch progress, billing, support, legal, and brand surfaces continue toward zenari.ai launch readiness.
- Admin/operator changes: Provider registry, strategy groups, queues, quota, billing operations, release readiness, safety, support, and audit surfaces are part of the current candidate scope.
- Release image scope: only backend, web, and admin are release images. Worker/crawler/migrate are backend runtime commands; manager is legacy local-only and not release metadata input.
- Backend runtime changes: Stage 1 API, worker fan-out, crawler governance, provider adapters, quota ledger, Stripe, object storage, trace, safety, team seats, and release validators are in scope through the backend image.
- Ops/config changes: Local ports, Stripe test placeholders, OpenAI-compatible provider placeholders, metrics ports, release metadata preflight, release bundle, staging runtime, and production launch gates are in scope.

## Migration List

- backend/migrations/0001_lane1_core.sql
- backend/migrations/0002_stage0_rev2_domains.sql
- backend/migrations/0003_export_object_metadata_cleanup.sql
- backend/migrations/0004_server_side_analytics_events.sql
- backend/migrations/0005_tenant_isolation_constraints.sql
- backend/migrations/0006_support_ticket_evidence_links.sql
- backend/migrations/0007_support_ticket_required_evidence.sql
- backend/migrations/0008_immutable_audit_logs.sql
- backend/migrations/0009_server_side_workflow_analytics_triggers.sql
- backend/migrations/0010_export_status_analytics_triggers.sql
- backend/migrations/0011_stage1_provider_batch_contracts.sql
- backend/migrations/0012_stage1_stripe_billing_contracts.sql
- backend/migrations/0013_stage1_admin_billing_ops.sql
- backend/migrations/0014_stage1_team_seat_billing.sql
- backend/migrations/0015_stage1_default_paid_plan.sql
- backend/migrations/0016_stage1_safety_review_ops.sql
- backend/migrations/0017_stage1_export_override_ops.sql
- backend/migrations/0018_stage1_support_ticket_links.sql
- backend/migrations/0019_stage1_asset_library_brand_kits.sql
- backend/migrations/0020_stage1_local_runtime_drift_repair.sql
- backend/migrations/0021_stage1_provider_strategy_metadata_repair.sql
- backend/migrations/0022_stage1_provider_usage_batch_task_refs.sql
- backend/migrations/0023_stage1_local_admin_devport_seed_repair.sql
- Expand/contract compatibility notes: compatible for local contract validation only; strict staging migration evidence is not attached.
- Worker schema compatibility notes: local contracts exist, but deployed worker drain and restart evidence is not attached.
- Rollback constraints: forward repair required for any production migration until rollback drill evidence is attached.

## Config Diff

- Environment variables added or tracked in `.env.example`: APP_BRAND_NAME, APP_PUBLIC_DOMAIN, NEXT_PUBLIC_APP_BRAND_NAME, NEXT_PUBLIC_APP_DOMAIN, ZENARI_ENV, SERVICE_NAME, PUBLIC_APP_ORIGIN, PUBLIC_ADMIN_ORIGIN, API_BASE_URL, NEXT_PUBLIC_ADMIN_BASE_PATH, WEB_PORT, NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_STAGE0_ACCESS_MODE, NEXT_PUBLIC_ANALYTICS_ENABLED, ADMIN_PORT, ADMIN_PLAYWRIGHT_PORT, ADMIN_API_BASE_URL, NEXT_PUBLIC_ADMIN_API_BASE_URL, NEXT_PUBLIC_ADMIN_AUTH_MODE, STAGING_SSH_HOST, STAGING_SSH_USER, STAGING_SSH_TARGET, STAGING_SSH_KEY, STAGING_SSH_PASSWORD, STAGING_SSH_CONNECT_TIMEOUT, STAGING_SSH_HARD_TIMEOUT, STAGING_REMOTE_DIR, STAGING_PUBLIC_HOST, STAGING_ADMIN_HOST, STAGING_PENDING_DOMAIN, STAGING_INCLUDE_PRODUCTION_HOSTS, STAGING_PRODUCTION_HOSTS, STAGING_API_URL, STAGING_WEB_URL, STAGING_ADMIN_URL, ADMIN_BEARER_TOKEN, ADMIN_SESSION_COOKIE, STAGING_ADMIN_SESSION_COOKIE, SMOKE_ADMIN_USER_ID, SMOKE_ADMIN_TENANT_ID, CSRF_ORIGIN, STAGING_DATABASE_URL, STAGING_QUOTA_REPLAY_API_URL, STAGING_QUOTA_REPLAY_TENANT_ID, STAGING_QUOTA_REPLAY_BATCH_ID, AZURE_SUBSCRIPTION_ID, AZURE_TENANT_ID, AZURE_RESOURCE_GROUP, AZURE_VM_NAME, PRODUCTION_DNS_TARGET, PRODUCTION_WEB_URL, PRODUCTION_API_URL, PRODUCTION_ADMIN_URL, CLOUDFLARE_ZONE_ID, CF_ZONE_ID, CF_API_TOKEN, BACKEND_IMAGE, HTTP_ADDR, HTTP_READ_HEADER_TIMEOUT, BACKEND_PORT, CORS_ALLOWED_ORIGINS, CONTENT_SECURITY_POLICY, CSRF_HEADER_NAME, CSRF_HEADER_VALUE, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_CONTENT_TYPES, UPLOAD_URL_TTL, MALWARE_SCAN_PROVIDER, MALWARE_SCAN_ENDPOINT, MALWARE_SCAN_API_KEY, MALWARE_SCAN_TIMEOUT, MALWARE_SCAN_FAIL_CLOSED, TASK_SCHEMA_VERSION, WORKER_INSTANCE_ID, WORKER_VERSION, WORKER_POLL_INTERVAL, WORKER_CLAIM_TIMEOUT, WORKER_DRAIN_GRACE_TIMEOUT, WORKER_CLEANUP_INTERVAL, POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, DATABASE_URL, POSTGRES_CHECK_TIMEOUT, REDIS_HOST, REDIS_PORT, REDIS_ADDR, REDIS_PASSWORD, REDIS_DB, REDIS_CHECK_TIMEOUT, OBJECT_STORAGE_PROVIDER, OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_PUBLIC_ENDPOINT, OBJECT_STORAGE_REGION, OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ACCESS_KEY, OBJECT_STORAGE_SECRET_KEY, OBJECT_STORAGE_USE_SSL, OBJECT_STORAGE_FORCE_PATH_STYLE, OBJECT_STORAGE_LOCAL_ROOT, OBJECT_STORAGE_SIGNING_KEY, OBJECT_STORAGE_DOWNLOAD_URL_TTL, OBJECT_STORAGE_CHECK_TIMEOUT, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, R2_BUCKET_CREATE_JURISDICTION, WORKER_CLEANUP_TIMEOUT, WORKER_CLEANUP_BATCH_LIMIT, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, MINIO_API_PORT, MINIO_CONSOLE_PORT, STAGE0_ACCESS_MODE, SESSION_COOKIE_NAME, SESSION_SECRET, SESSION_TTL, SESSION_COOKIE_SECURE, SESSION_COOKIE_SAME_SITE, SESSION_COOKIE_DOMAIN, DEV_IDENTITY_HEADERS_ENABLED, ADMIN_DEV_IDENTITY_HEADERS_ENABLED, ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_SECRET, ADMIN_SESSION_TTL, LOCAL_SEED_USER_EMAIL, LOCAL_SEED_ADMIN_EMAIL, PROVIDER_MODE, DEV_PROVIDER_SEED, PROVIDER_REQUEST_TIMEOUT, PROVIDER_DAILY_SPEND_CAP_CENTS, PROVIDER_EMERGENCY_KILL_SWITCH, RATELIMIT_ENABLED, RATELIMIT_STORE, RATELIMIT_USER_REQUESTS_PER_MINUTE, RATELIMIT_TENANT_REQUESTS_PER_MINUTE, RATELIMIT_PROVIDER_REQUESTS_PER_MINUTE, RATELIMIT_ADMIN_ACTIONS_PER_MINUTE, RATELIMIT_PROVIDER_DAILY_SPEND_CAP_CENTS, RATELIMIT_PROVIDER_EMERGENCY_KILL_SWITCH, LLM_PROVIDER, LLM_OPENAI_BASE_URL, LLM_OPENAI_API_KEY, ZAI_API_KEY, OPENAI_API_KEY, LLM_OPENAI_MODEL, LLM_REQUEST_TIMEOUT, LLM_ENABLE_LIVE_CALLS, CHECKOUT_PROVIDER, WEEKLY_QUOTA_UNITS, STRIPE_MODE, STRIPE_API_BASE_URL, STRIPE_API_KEY, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, BILLING_WEBHOOK_SECRET, STRIPE_SANDBOX_PRODUCT_ID, STRIPE_DEFAULT_PRICE_ID, STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL, STRIPE_PORTAL_RETURN_URL, STRIPE_CLI_FORWARD_TO, STRIPE_SANDBOX_SELFTEST_REQUIRED, STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID, STAGE1_PROD_BILLING_CHECKOUT_CUSTOMER_ID, STAGE1_PROD_BILLING_PRICE_ID, STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_ID, STAGE1_PROD_BILLING_ACTIVE_CUSTOMER_ID, STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_STATUS, STAGE1_PROD_BILLING_PAST_DUE_SUBSCRIPTION_ID, STAGE1_PROD_BILLING_PAST_DUE_INVOICE_ID, STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_ID, STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_STATUS, STAGE1_PROD_BILLING_SEAT_QUANTITY, STAGE1_PROD_BILLING_SYNCED_QUANTITY, STAGE1_PROD_BILLING_SUBSCRIPTION_ITEM_ID, STAGE1_PROD_BILLING_PRORATION_BEHAVIOR, STAGE1_PROD_BILLING_SYNC_IDEMPOTENCY_KEY, STAGE1_PROD_BILLING_VISIBLE_INVOICE_ID, STAGE1_PROD_BILLING_REFUND_STATUS, STAGE1_PROD_BILLING_ADMIN_OPERATION, STAGE1_PROD_BILLING_REFUND_CHARGE_ID, STAGE1_PROD_BILLING_REFUND_ID, STAGE1_PROD_BILLING_QUOTA_RESET_INVOICE_ID, STAGE1_PROD_BILLING_WEBHOOK_EVENT_IDS, STAGE1_PROD_BILLING_FIRST_DELIVERY_MUTATIONS, STAGE1_PROD_BILLING_REPLAY_DELIVERY_MUTATIONS, STAGE1_PROD_BILLING_DUPLICATE_MUTATION_COUNT, STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_ID, STAGE1_PROD_BILLING_LIVE_TEST_SEPARATION_REF, STAGE1_PROD_BILLING_PAID_CHECKOUT_REF, STAGE1_PROD_BILLING_SUBSCRIPTION_ACTIVE_REF, STAGE1_PROD_BILLING_SUBSCRIPTION_PAST_DUE_REF, STAGE1_PROD_BILLING_SUBSCRIPTION_CANCEL_REF, STAGE1_PROD_BILLING_TEAM_SEAT_REF, STAGE1_PROD_BILLING_INVOICE_VISIBILITY_REF, STAGE1_PROD_BILLING_LIFECYCLE_AUDIT_REF, STAGE1_PROD_BILLING_REFUND_CREDIT_REF, STAGE1_PROD_BILLING_QUOTA_RESET_REF, STAGE1_PROD_BILLING_WEBHOOK_IDEMPOTENCY_REF, STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_REF, STAGE1_PROD_BILLING_QUOTA_PROJECTION_REF, STAGE1_PROD_BILLING_REFUND_WEBHOOK_AUDIT_REF, STAGE1_PROD_SECURITY_SAME_SITE, STAGE1_PROD_SECURITY_RAW_SECRET_EXPOSURE_COUNT, STAGE1_PROD_SECURITY_FRONTEND_SECRET_EXPOSURE_COUNT, STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF, STAGE1_PROD_SECURITY_CSRF_SAME_SITE_REF, STAGE1_PROD_SECURITY_SECRET_REDACTION_REF, STAGE1_PROD_SECURITY_ADMIN_SURFACE_PRIVACY_REF, STAGE1_PROD_SECURITY_PROVIDER_KEY_CONTAINMENT_REF, STAGE1_PROD_SECURITY_STRIPE_LIVE_TEST_SEPARATION_REF, STAGE1_PROD_SECURITY_RATE_LIMIT_SPEND_CAP_REF, STAGE1_PROD_SECURITY_CSP_HEADERS_REF, STAGE1_PROD_SECURITY_RBAC_TENANT_ISOLATION_REF, STAGE1_PROD_SECURITY_AUDIT_REF, STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS, STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_REFS, STAGE1_PROD_GOVERNANCE_ACTIVATION_HIGH_RISK_RBAC_REF, STAGE1_PROD_GOVERNANCE_ACTIVATION_REVIEWER_RATIONALE_REF, STAGE1_PROD_GOVERNANCE_ACTIVATION_SECOND_REVIEW_REF, STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_IMMUTABILITY_REF, STAGE1_PROD_GOVERNANCE_ACTIVATION_GATES_REF, STAGE1_PROD_GOVERNANCE_ABUSE_RUNTIME_REQUEST_IDS, STAGE1_PROD_GOVERNANCE_ABUSE_AUDIT_REFS, STAGE1_PROD_GOVERNANCE_ABUSE_ACCOUNT_HOLD_REF, STAGE1_PROD_GOVERNANCE_ABUSE_RATE_LIMIT_REF, STAGE1_PROD_GOVERNANCE_ABUSE_SPEND_CAP_OR_KILL_SWITCH_REF, STAGE1_PROD_GOVERNANCE_ABUSE_RBAC_AUDIT_REF, STAGE1_PROD_GOVERNANCE_SKILL_RUNTIME_REQUEST_IDS, STAGE1_PROD_GOVERNANCE_SKILL_AUDIT_REFS, STAGE1_PROD_GOVERNANCE_SKILL_OWNER_ID, STAGE1_PROD_GOVERNANCE_SKILL_RISK_LEVEL, STAGE1_PROD_GOVERNANCE_SKILL_SUITE_ID, STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_ID, STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_ID, STAGE1_PROD_GOVERNANCE_SKILL_CANARY_SAMPLE_SIZE, STAGE1_PROD_GOVERNANCE_SKILL_OWNER_RISK_REF, STAGE1_PROD_GOVERNANCE_SKILL_EVAL_SUITE_REF, STAGE1_PROD_GOVERNANCE_SKILL_SAFETY_REFS_REF, STAGE1_PROD_GOVERNANCE_SKILL_CANARY_METRICS_REF, STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_REF, STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_REF, LOG_FORMAT, LOG_LEVEL, REQUEST_ID_HEADER, OTEL_ENABLED, OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, METRICS_ENABLED, METRICS_PORT, WORKER_METRICS_PORT, CRAWLER_METRICS_PORT, WORKER_BATCH_ENABLED, WORKER_BATCH_TENANT_ID, WORKER_BATCH_POLL_INTERVAL, WORKER_BATCH_CLAIM_LIMIT, WORKER_BATCH_CLAIM_TIMEOUT, WORKER_BATCH_MAX_TENANT_CONCURRENCY, WORKER_BATCH_PROVIDER_MAX_CONCURRENCY, WORKER_BATCH_PROVIDER_MODEL_MAX_CONCURRENCY, WORKER_BATCH_ALLOWED_PROVIDER_MODEL_TOOLS, FRONTEND_ERROR_REPORTING_DSN, CRAWLER_ENABLED, CRAWLER_USER_AGENT, CRAWLER_GLOBAL_RPS, CRAWLER_SOURCE_RPS, CRAWLER_RAW_RETENTION_DAYS, CRAWLER_BLOCKLIST_HOSTS, ANALYTICS_ENABLED, ANALYTICS_PROVIDER, ANALYTICS_WRITE_KEY
- Secret-bearing variable names tracked without values: STAGING_SSH_KEY, STAGING_SSH_PASSWORD, ADMIN_BEARER_TOKEN, ADMIN_SESSION_COOKIE, STAGING_ADMIN_SESSION_COOKIE, CF_API_TOKEN, MALWARE_SCAN_API_KEY, POSTGRES_PASSWORD, REDIS_PASSWORD, OBJECT_STORAGE_ACCESS_KEY, OBJECT_STORAGE_SECRET_KEY, OBJECT_STORAGE_SIGNING_KEY, CLOUDFLARE_API_TOKEN, MINIO_ROOT_PASSWORD, SESSION_COOKIE_NAME, SESSION_SECRET, SESSION_TTL, SESSION_COOKIE_SECURE, SESSION_COOKIE_SAME_SITE, SESSION_COOKIE_DOMAIN, ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_SECRET, ADMIN_SESSION_TTL, LLM_OPENAI_API_KEY, ZAI_API_KEY, OPENAI_API_KEY, STRIPE_API_KEY, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, BILLING_WEBHOOK_SECRET, STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID, STAGE1_PROD_BILLING_SYNC_IDEMPOTENCY_KEY, STAGE1_PROD_BILLING_WEBHOOK_EVENT_IDS, STAGE1_PROD_BILLING_WEBHOOK_IDEMPOTENCY_REF, STAGE1_PROD_BILLING_REFUND_WEBHOOK_AUDIT_REF, STAGE1_PROD_SECURITY_RAW_SECRET_EXPOSURE_COUNT, STAGE1_PROD_SECURITY_FRONTEND_SECRET_EXPOSURE_COUNT, STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF, STAGE1_PROD_SECURITY_SECRET_REDACTION_REF, STAGE1_PROD_SECURITY_PROVIDER_KEY_CONTAINMENT_REF, ANALYTICS_WRITE_KEY
- Secret source changes: names only; no secret values are recorded by this draft.
- Object storage changes: MinIO/S3-compatible local ports and bucket naming are documented in `.env.example` and `docker-compose.yml`; strict staging policy evidence remains required.
- Provider/model routing changes: provider registry and strategy-group contracts exist locally; strict staging provider sandbox evidence remains required.

## Feature Flags

- Enabled: Stage 1 local contract validators, release metadata preflight, Stripe test-mode placeholders, OpenAI-compatible provider contract checks.
- Disabled: production launch, Do-Not-Launch closure, live Stripe launch, release metadata completion.
- Emergency rollback flags: `PROVIDER_EMERGENCY_KILL_SWITCH=true`, `RATELIMIT_PROVIDER_EMERGENCY_KILL_SWITCH=true`, `WORKER_BATCH_ENABLED=false`.

## Smoke Plan

- Backend health/readiness: run `scripts/staging_smoke.sh` against production-like staging and attach validator-readable evidence.
- Web smoke: run Playwright smoke from installed CI or production-like staging and attach evidence.
- Admin smoke: run admin provider, quota, billing, release, safety, support, and audit smoke against production-like staging and attach evidence.
- Export/package smoke: attach signed download, manifest, rendered export, retention, and cleanup evidence from staging.
- Signed download smoke: attach canonical staging signed URL and retention cleanup split evidence.
- Backend runtime smoke: attach worker drain, batch fan-out, queue, provider, and crawler governance evidence under the backend release image.
- Quota/rate-limit smoke: attach quota ledger, Stripe webhook, provider usage, and Redis-backed rate-limit evidence.

## Evidence

- CI workflow file: `present` at `.github/workflows/stage0-rev2-ci.yml`.
- Draft metadata sidecars:
- migration_evidence: `ops/evidence/release/staging/stage1-release-candidate-migration-draft.json`; candidate-only and not strict staging evidence.
- config_diff_evidence: `ops/evidence/release/staging/stage1-release-candidate-config-diff-draft.json`; candidate-only and not strict staging evidence.
- observability_evidence: `ops/evidence/release/staging/stage1-release-candidate-observability-draft.json`; candidate-only and not strict staging evidence.
- backup_restore_evidence: `ops/evidence/release/staging/stage1-release-candidate-backup-restore-draft.json`; candidate-only and not strict staging evidence.
- load_evidence: `ops/evidence/release/staging/stage1-release-candidate-load-draft.json`; candidate-only and not strict staging evidence.
- rollback_evidence: `ops/evidence/release/staging/stage1-release-candidate-rollback-draft.json`; candidate-only and not strict staging evidence.
- security_scan_evidence: `ops/evidence/release/staging/stage1-release-candidate-security-scan-draft.json`; candidate-only and not strict staging evidence.
- Release metadata preflight: `ops/evidence/release/staging/stage1-release-metadata-preflight.json`.
- Release bundle: `ops/evidence/release/staging/stage0-rev2-current-release-evidence-bundle.json`.
- Production launch evidence: `ops/evidence/production/stage1-production-launch.json`.
- Strict metadata slots still open:
- image_refs: missing strict validator-readable staging evidence
- migration_evidence: missing strict validator-readable staging evidence
- config_diff_evidence: missing strict validator-readable staging evidence
- observability_evidence: missing strict validator-readable staging evidence
- backup_restore_evidence: missing strict validator-readable staging evidence
- load_evidence: missing strict validator-readable staging evidence
- rollback_evidence: missing strict validator-readable staging evidence
- security_scan_evidence: missing strict validator-readable staging evidence

## Rollback Plan

- Previous SHA: `not-selected`
- Image rollback command: `not-ready; requires CI image refs for backend, web, and admin`.
- Feature flag rollback: set `WORKER_BATCH_ENABLED=false`, provider kill switches on, and keep production launch gate no-go.
- Migration repair plan: forward repair only until staging rollback and production backup/rollback split evidence pass.
- Worker drain plan: use worker drain procedure after staging evidence proves idempotent restart and no duplicate child execution.
- Owner and escalation: release owner not assigned in this draft.

## Known Risks

- Open private beta blockers: strict staging runtime, load, object retention, provider sandbox, Stripe, observability, backup, safety, and legal/support evidence must remain validator-owned.
- Open production do-not-launch conditions: CI exact evidence, staging runtime, release bundle, production billing, security, provider claims, backup/restore, rollback, legal/support, and governance evidence remain open.
- Operational risks: worktree is `dirty`; release SHA identifies HEAD only and does not by itself prove current uncommitted changes.
- User/support risks: paid launch support, billing, refund, IP complaint, and incident paths still require staging and production proof.

## Go/No-Go

- Decision: `no-go`
- Approver: `not-approved`
- Conditions: no-go until CI, staging, smoke, observability, restore, rollback, security, release owner, image refs, and production split evidence are attached and validators pass.
- Follow-up deadline: `n/a`
