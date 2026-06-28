-- zenari.ai Stage 1 provider registry and batch generation contracts.
-- Forward-only additive migration. Existing Stage 0 tables stay compatible.

CREATE TABLE IF NOT EXISTS provider_registry (
	id text PRIMARY KEY,
	provider_id text NOT NULL UNIQUE,
	display_name text NOT NULL,
	mode text NOT NULL,
	status text NOT NULL,
	secret_ref text NOT NULL DEFAULT '',
	routing jsonb NOT NULL DEFAULT '{}'::jsonb,
	health jsonb NOT NULL DEFAULT '{}'::jsonb,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT provider_registry_mode_check CHECK (mode IN ('dev', 'sandbox', 'production')),
	CONSTRAINT provider_registry_status_check CHECK (status IN ('enabled', 'disabled', 'kill_switch')),
	CONSTRAINT provider_registry_secret_ref_check CHECK (
		mode = 'dev'
		OR secret_ref ~ '^(secrets|vault|aws-sm|gcp-sm|doppler|infisical|1password)/[A-Za-z0-9._:/-]+$'
	)
);

CREATE TABLE IF NOT EXISTS provider_model_capabilities (
	id text PRIMARY KEY,
	provider_registry_id text NOT NULL REFERENCES provider_registry(id),
	provider_id text NOT NULL,
	model_id text NOT NULL,
	endpoints text[] NOT NULL DEFAULT '{}',
	input_types text[] NOT NULL DEFAULT '{}',
	output_types text[] NOT NULL DEFAULT '{}',
	tool_types text[] NOT NULL DEFAULT '{}',
	max_cost_units bigint NOT NULL DEFAULT 0 CHECK (max_cost_units >= 0),
	cost_currency text NOT NULL DEFAULT '',
	estimated_cost_cents bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_cents >= 0),
	supports_batch boolean NOT NULL DEFAULT false,
	max_batch_size integer NOT NULL DEFAULT 1 CHECK (max_batch_size >= 1),
	supports_seed boolean NOT NULL DEFAULT false,
	supports_cancel boolean NOT NULL DEFAULT false,
	supported_aspect_ratios text[] NOT NULL DEFAULT '{}',
	supported_qualities text[] NOT NULL DEFAULT '{}',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (provider_id, model_id),
	CONSTRAINT provider_model_capability_batch_size_check CHECK (supports_batch = false OR max_batch_size >= 2)
);

CREATE TABLE IF NOT EXISTS provider_strategy_groups (
	id text PRIMARY KEY,
	group_id text NOT NULL UNIQUE,
	display_name text NOT NULL,
	tool_type text NOT NULL,
	status text NOT NULL,
	selection_policy text NOT NULL,
	fallback_provider_ids text[] NOT NULL DEFAULT '{}',
	kill_switch boolean NOT NULL DEFAULT false,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT provider_strategy_group_status_check CHECK (status IN ('enabled', 'disabled', 'kill_switch')),
	CONSTRAINT provider_strategy_group_selection_policy_check CHECK (selection_policy IN ('weighted', 'priority', 'canary', 'failover')),
	CONSTRAINT provider_strategy_group_kill_switch_check CHECK (status <> 'kill_switch' OR kill_switch = true)
);

CREATE TABLE IF NOT EXISTS provider_strategy_group_members (
	id text PRIMARY KEY,
	strategy_group_id text NOT NULL REFERENCES provider_strategy_groups(id) ON DELETE CASCADE,
	group_id text NOT NULL,
	provider_id text NOT NULL REFERENCES provider_registry(provider_id),
	weight integer NOT NULL DEFAULT 0 CHECK (weight >= 0),
	canary_percent integer NOT NULL DEFAULT 0 CHECK (canary_percent >= 0 AND canary_percent <= 100),
	max_concurrency integer NOT NULL DEFAULT 0 CHECK (max_concurrency >= 0),
	fallback_rank integer NOT NULL DEFAULT 0 CHECK (fallback_rank >= 0),
	enabled boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (group_id, provider_id)
);

CREATE TABLE IF NOT EXISTS batch_generation_requests (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text NOT NULL REFERENCES users(id),
	project_id text NOT NULL REFERENCES projects(id),
	workspace_id text NOT NULL REFERENCES workspaces(id),
	prompt_context jsonb NOT NULL DEFAULT '{}'::jsonb,
	requested_count integer NOT NULL CHECK (requested_count > 0 AND requested_count <= 20),
	allowed_models text[] NOT NULL DEFAULT '{}',
	quota_reservation_id text NOT NULL,
	quota_bucket_id text REFERENCES quota_buckets(id),
	quota_estimated_units bigint NOT NULL DEFAULT 0 CHECK (quota_estimated_units >= 0),
	quota_committed_units bigint NOT NULL DEFAULT 0 CHECK (quota_committed_units >= 0),
	quota_refunded_units bigint NOT NULL DEFAULT 0 CHECK (quota_refunded_units >= 0),
	trace_id text NOT NULL,
	status text NOT NULL,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT batch_generation_status_check CHECK (status IN ('queued', 'running', 'partial_succeeded', 'succeeded', 'failed', 'cancelled', 'blocked')),
	CONSTRAINT batch_generation_quota_balance_check CHECK (quota_committed_units + quota_refunded_units <= quota_estimated_units)
);

CREATE TABLE IF NOT EXISTS generation_child_tasks (
	id text PRIMARY KEY,
	batch_id text NOT NULL REFERENCES batch_generation_requests(id),
	tenant_id text NOT NULL REFERENCES tenants(id),
	status text NOT NULL,
	provider_id text NOT NULL,
	model_id text NOT NULL,
	tool_type text NOT NULL,
	seed text NOT NULL DEFAULT '',
	retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
	max_retries integer NOT NULL DEFAULT 0 CHECK (max_retries >= 0),
	quota_estimate_units bigint NOT NULL DEFAULT 0 CHECK (quota_estimate_units >= 0),
	quota_committed_units bigint NOT NULL DEFAULT 0 CHECK (quota_committed_units >= 0),
	quota_refunded_units bigint NOT NULL DEFAULT 0 CHECK (quota_refunded_units >= 0),
	asset_id text REFERENCES assets(id),
	canvas_object_id text REFERENCES canvas_nodes(id),
	trace_id text NOT NULL,
	visible_trace_ref text NOT NULL DEFAULT '',
	failure_code text NOT NULL DEFAULT '',
	failure_message text NOT NULL DEFAULT '',
	review_reason text NOT NULL DEFAULT '',
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT generation_child_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'blocked')),
	CONSTRAINT generation_child_retry_check CHECK (retry_count <= max_retries),
	CONSTRAINT generation_child_quota_balance_check CHECK (quota_committed_units + quota_refunded_units <= quota_estimate_units),
	CONSTRAINT generation_child_success_output_check CHECK (status != 'succeeded' OR (asset_id IS NOT NULL AND canvas_object_id IS NOT NULL)),
	CONSTRAINT generation_child_failed_code_check CHECK (status != 'failed' OR failure_code <> ''),
	CONSTRAINT generation_child_blocked_reason_check CHECK (status != 'blocked' OR review_reason <> '')
);

CREATE INDEX IF NOT EXISTS idx_provider_registry_mode_status ON provider_registry(mode, status);
CREATE INDEX IF NOT EXISTS idx_provider_model_capabilities_provider ON provider_model_capabilities(provider_id, model_id);
CREATE INDEX IF NOT EXISTS idx_provider_strategy_groups_tool_status ON provider_strategy_groups(tool_type, status);
CREATE INDEX IF NOT EXISTS idx_provider_strategy_group_members_group ON provider_strategy_group_members(group_id, enabled);
CREATE INDEX IF NOT EXISTS idx_provider_strategy_group_members_provider ON provider_strategy_group_members(provider_id);
CREATE INDEX IF NOT EXISTS idx_batch_generation_tenant_created ON batch_generation_requests(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_generation_project_workspace ON batch_generation_requests(tenant_id, project_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_batch_generation_quota_bucket ON batch_generation_requests(tenant_id, quota_bucket_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_generation_requests_tenant_id_unique ON batch_generation_requests(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_generation_child_batch ON generation_child_tasks(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_generation_child_provider_model ON generation_child_tasks(provider_id, model_id, status);
CREATE INDEX IF NOT EXISTS idx_generation_child_retry_queue ON generation_child_tasks(tenant_id, status, retry_count, max_retries)
	WHERE status IN ('queued', 'failed');

COMMENT ON COLUMN generation_child_tasks.metadata IS 'Stage 1 child execution metadata; retry_state and dead_letter_state are public-safe operational summaries, never raw provider payloads or secrets.';
