-- zenari.ai Stage 1 local admin devport seed repair.
-- Forward-only data repair for long-lived local databases that already
-- applied Stage 1 schema migrations before admin provider strategy and team
-- seat smoke seed rows were complete.

INSERT INTO teams(id, tenant_id, name, plan_id, seat_limit)
VALUES (
	'team_1',
	'tenant_local',
	'Zenari Local Team',
	'plan_pro',
	5
)
ON CONFLICT (tenant_id, id) DO UPDATE
SET name = EXCLUDED.name,
    plan_id = EXCLUDED.plan_id,
    seat_limit = GREATEST(teams.seat_limit, EXCLUDED.seat_limit),
    updated_at = now();

INSERT INTO team_members(id, team_id, tenant_id, user_id, email, role, status)
VALUES (
	'team_member:team_1:user_local_admin',
	'team_1',
	'tenant_local',
	'user_local_admin',
	'admin@zenari.ai',
	'owner',
	'active'
)
ON CONFLICT (tenant_id, team_id, id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    removed_by = '',
    removed_at = NULL,
    updated_at = now();

UPDATE provider_strategy_groups
SET fallback_provider_ids = ARRAY['zenari-image-sandbox'],
    metadata = metadata || '{"local_admin_devport_seed_repair":"0023"}'::jsonb,
    updated_at = now()
WHERE group_id = 'image-generation-default';

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

COMMENT ON TABLE teams IS 'Stage 1 tenant-scoped teams with seat limits derived from billing plan entitlements. Local team_1 is seeded for admin quota devport smoke.';
COMMENT ON TABLE provider_strategy_group_members IS 'Stage 1 provider strategy group members; provider IDs reference provider_registry and never store provider secrets. Local image-generation-default membership is repaired by 0023 when needed.';
