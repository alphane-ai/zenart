-- zenari.ai Stage 1 local runtime drift repair.
-- Forward-only additive repair for long-lived local/staging databases where an
-- earlier 0011 migration was recorded before provider strategy groups and
-- local Stage 1 smoke seed rows were added to the migration contract.

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

CREATE INDEX IF NOT EXISTS idx_provider_strategy_groups_tool_status
	ON provider_strategy_groups(tool_type, status);

CREATE INDEX IF NOT EXISTS idx_provider_strategy_group_members_group
	ON provider_strategy_group_members(group_id, enabled);

CREATE INDEX IF NOT EXISTS idx_provider_strategy_group_members_provider
	ON provider_strategy_group_members(provider_id);

INSERT INTO workspaces(id, tenant_id, project_id, name, metadata)
VALUES (
	'ws_stage1_smoke',
	'tenant_local',
	'project_local_ecommerce_growth',
	'Stage 1 Local Smoke Workspace',
	'{"stage":"stage1","local_devport_smoke":"true"}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    project_id = EXCLUDED.project_id,
    name = EXCLUDED.name,
    metadata = workspaces.metadata || EXCLUDED.metadata,
    updated_at = now();

INSERT INTO provider_strategy_groups(
	id,
	group_id,
	display_name,
	tool_type,
	status,
	selection_policy,
	fallback_provider_ids,
	kill_switch,
	metadata
)
VALUES (
	'psg_stage1_image_generate_default',
	'image-generation-default',
	'Zenari image generation default',
	'image.generate',
	'enabled',
	'weighted',
	ARRAY['dev'],
	false,
	'{"stage":"stage1","local_devport_smoke":"true","source":"0020_stage1_local_runtime_drift_repair"}'::jsonb
)
ON CONFLICT (group_id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    tool_type = EXCLUDED.tool_type,
    status = EXCLUDED.status,
    selection_policy = EXCLUDED.selection_policy,
    fallback_provider_ids = EXCLUDED.fallback_provider_ids,
    kill_switch = EXCLUDED.kill_switch,
    metadata = provider_strategy_groups.metadata || EXCLUDED.metadata,
    updated_at = now();

INSERT INTO provider_strategy_group_members(
	id,
	strategy_group_id,
	group_id,
	provider_id,
	weight,
	canary_percent,
	max_concurrency,
	fallback_rank,
	enabled
)
SELECT
	'psgm_stage1_image_generate_default_zenari_image_sandbox',
	psg.id,
	psg.group_id,
	'zenari-image-sandbox',
	100,
	0,
	4,
	0,
	true
FROM provider_strategy_groups psg
JOIN provider_registry pr ON pr.provider_id = 'zenari-image-sandbox'
WHERE psg.group_id = 'image-generation-default'
ON CONFLICT (group_id, provider_id) DO UPDATE
SET strategy_group_id = EXCLUDED.strategy_group_id,
    weight = EXCLUDED.weight,
    canary_percent = EXCLUDED.canary_percent,
    max_concurrency = EXCLUDED.max_concurrency,
    fallback_rank = EXCLUDED.fallback_rank,
    enabled = EXCLUDED.enabled,
    updated_at = now();

UPDATE quota_buckets
SET limit_units = GREATEST(limit_units, 1000),
    updated_at = now()
WHERE tenant_id = 'tenant_local'
  AND subject_type = 'user'
  AND subject_id IN ('user_local_user', 'user_local_admin');

COMMENT ON TABLE provider_strategy_groups IS 'Stage 1 provider routing strategy groups for admin-managed model/provider policy. This table may be created by 0011 on fresh databases or repaired by 0020 on long-lived databases.';
COMMENT ON TABLE provider_strategy_group_members IS 'Stage 1 provider strategy group members; provider IDs reference provider_registry and never store provider secrets.';
