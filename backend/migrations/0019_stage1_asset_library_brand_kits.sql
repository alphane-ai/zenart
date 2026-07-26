-- zenari.ai Stage 1 asset library and Brand Kit contracts.
-- Forward-only additive tables for tenant-safe asset reuse and prompt-context
-- brand references. JSONB columns are public-safe projections, not raw uploads,
-- provider payloads, prompt text, or secrets.

CREATE TABLE IF NOT EXISTS asset_library_entries (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	asset_id text NOT NULL,
	visibility text NOT NULL DEFAULT 'project',
	favorite boolean NOT NULL DEFAULT false,
	archived boolean NOT NULL DEFAULT false,
	reusable boolean NOT NULL DEFAULT false,
	allowed_project_ids text[] NOT NULL DEFAULT '{}',
	tags text[] NOT NULL DEFAULT '{}',
	created_by text NOT NULL REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT asset_library_visibility_check CHECK (visibility IN ('project', 'tenant', 'private')),
	CONSTRAINT asset_library_archive_favorite_check CHECK (archived = false OR favorite = false),
	CONSTRAINT asset_library_private_reuse_check CHECK (visibility <> 'private' OR reusable = false)
);

CREATE TABLE IF NOT EXISTS brand_kits (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	name text NOT NULL,
	status text NOT NULL DEFAULT 'draft',
	logo_asset_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
	palette jsonb NOT NULL DEFAULT '[]'::jsonb,
	fonts jsonb NOT NULL DEFAULT '[]'::jsonb,
	guidelines jsonb NOT NULL DEFAULT '[]'::jsonb,
	source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
	project_bindings jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_by text NOT NULL REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT brand_kits_status_check CHECK (status IN ('draft', 'active', 'archived')),
	CONSTRAINT brand_kits_logo_refs_array_check CHECK (jsonb_typeof(logo_asset_refs) = 'array'),
	CONSTRAINT brand_kits_palette_array_check CHECK (jsonb_typeof(palette) = 'array'),
	CONSTRAINT brand_kits_guidelines_array_check CHECK (jsonb_typeof(guidelines) = 'array'),
	CONSTRAINT brand_kits_project_bindings_array_check CHECK (jsonb_typeof(project_bindings) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_library_entries_tenant_id_unique
	ON asset_library_entries(tenant_id, id);

CREATE INDEX IF NOT EXISTS idx_asset_library_entries_tenant_asset
	ON asset_library_entries(tenant_id, asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_library_entries_tenant_visibility
	ON asset_library_entries(tenant_id, visibility, archived, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_kits_tenant_id_unique
	ON brand_kits(tenant_id, id);

CREATE INDEX IF NOT EXISTS idx_brand_kits_tenant_status
	ON brand_kits(tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_brand_kits_project_bindings_gin
	ON brand_kits USING gin(project_bindings);

CREATE OR REPLACE FUNCTION add_stage1_brand_asset_fk_if_missing(
	constraint_name text,
	table_name text,
	child_columns text,
	parent_table text,
	parent_columns text
) RETURNS void AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = constraint_name
		  AND conrelid = table_name::regclass
	) THEN
		EXECUTE format(
			'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I(%s) NOT VALID',
			table_name,
			constraint_name,
			child_columns,
			parent_table,
			parent_columns
		);
	END IF;
END;
$$ LANGUAGE plpgsql;

SELECT add_stage1_brand_asset_fk_if_missing(
	'fk_asset_library_entries_tenant_asset',
	'asset_library_entries',
	'tenant_id, asset_id',
	'assets',
	'tenant_id, id'
);

SELECT add_stage1_brand_asset_fk_if_missing(
	'fk_asset_library_entries_tenant_created_by',
	'asset_library_entries',
	'tenant_id, created_by',
	'users',
	'tenant_id, id'
);

SELECT add_stage1_brand_asset_fk_if_missing(
	'fk_brand_kits_tenant_created_by',
	'brand_kits',
	'tenant_id, created_by',
	'users',
	'tenant_id, id'
);

DROP FUNCTION add_stage1_brand_asset_fk_if_missing(text, text, text, text, text);

COMMENT ON TABLE asset_library_entries IS 'Stage 1 tenant-safe asset library entries for canvas insertion, prompt attachment, favorite/archive, and cross-project reuse policy.';
COMMENT ON TABLE brand_kits IS 'Stage 1 Brand Kit projection with logo asset refs, palette, fonts, guidelines, source refs, and project default bindings. Raw brand book uploads or secrets are not stored here.';
