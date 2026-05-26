-- Stage 0 Rev2 export object metadata and retention cleanup contract.
-- Forward-only additive migration; old workers can keep writing legacy rows
-- while new workers populate the richer metadata fields.

ALTER TABLE object_metadata ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
ALTER TABLE object_metadata ADD COLUMN IF NOT EXISTS owner_id text REFERENCES users(id);
ALTER TABLE object_metadata ADD COLUMN IF NOT EXISTS asset_type text NOT NULL DEFAULT 'artifact';
ALTER TABLE object_metadata ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'configured';
ALTER TABLE object_metadata ADD COLUMN IF NOT EXISTS retention_state text NOT NULL DEFAULT 'active';
ALTER TABLE object_metadata ADD COLUMN IF NOT EXISTS derived_from_object_id text REFERENCES object_metadata(id);
ALTER TABLE object_metadata ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE exports ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
ALTER TABLE exports ADD COLUMN IF NOT EXISTS manifest jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE exports ADD COLUMN IF NOT EXISTS delivery_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE object_metadata
SET asset_type = CASE
	WHEN upload_id IS NOT NULL THEN 'upload:reference'
	ELSE asset_type
END
WHERE asset_type = 'artifact';

UPDATE exports e
SET project_id = p.project_id
FROM packages p
WHERE e.project_id IS NULL
  AND p.tenant_id = e.tenant_id
  AND p.id = e.package_id;

CREATE INDEX IF NOT EXISTS idx_object_metadata_retention ON object_metadata(tenant_id, retention_state, retention_until);
CREATE INDEX IF NOT EXISTS idx_object_metadata_project_asset ON object_metadata(tenant_id, project_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_exports_project_status ON exports(tenant_id, project_id, status);
