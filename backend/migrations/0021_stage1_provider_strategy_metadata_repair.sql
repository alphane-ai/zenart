-- zenari.ai Stage 1 provider strategy metadata repair.
-- Forward-only data repair for local/staging databases that applied 0020
-- before strategy group metadata was normalized to string values.

UPDATE workspaces
SET metadata = metadata || '{"local_devport_smoke":"true"}'::jsonb,
    updated_at = now()
WHERE id = 'ws_stage1_smoke'
  AND metadata ? 'local_devport_smoke';

UPDATE provider_strategy_groups
SET metadata = metadata || '{"local_devport_smoke":"true"}'::jsonb,
    updated_at = now()
WHERE group_id = 'image-generation-default'
  AND metadata ? 'local_devport_smoke';
