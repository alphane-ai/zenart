-- zenari.ai Stage 1 support ticket evidence links.
-- Adds batch and billing references for troubleshooting without storing raw
-- provider, prompt, billing payload, or secret material.

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS batch_id text;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS billing_reference_id text;

-- Repair older local databases that recorded 0011 before the tenant/id unique
-- index was added; PostgreSQL needs this key before the support FK can exist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_generation_requests_tenant_id_unique
	ON batch_generation_requests(tenant_id, id);

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_batch
	ON support_tickets(tenant_id, batch_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_billing_ref
	ON support_tickets(tenant_id, billing_reference_id, updated_at);

CREATE OR REPLACE FUNCTION add_stage1_support_ticket_fk_if_missing(
	constraint_name text,
	child_columns text,
	parent_table text,
	parent_columns text
) RETURNS void AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = constraint_name
		  AND conrelid = 'support_tickets'::regclass
	) THEN
		EXECUTE format(
			'ALTER TABLE support_tickets ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I(%s) NOT VALID',
			constraint_name,
			child_columns,
			parent_table,
			parent_columns
		);
	END IF;
END;
$$ LANGUAGE plpgsql;

SELECT add_stage1_support_ticket_fk_if_missing(
	'fk_support_tickets_tenant_batch',
	'tenant_id, batch_id',
	'batch_generation_requests',
	'tenant_id, id'
);

DROP FUNCTION add_stage1_support_ticket_fk_if_missing(text, text, text, text);

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'chk_support_tickets_required_evidence'
		  AND conrelid = 'support_tickets'::regclass
	) THEN
		ALTER TABLE support_tickets DROP CONSTRAINT chk_support_tickets_required_evidence;
	END IF;

	ALTER TABLE support_tickets
		ADD CONSTRAINT chk_support_tickets_required_evidence
		CHECK (
			tenant_id <> ''
			AND user_id <> ''
			AND project_id IS NOT NULL AND project_id <> ''
			AND task_id IS NOT NULL AND task_id <> ''
			AND batch_id IS NOT NULL AND batch_id <> ''
			AND trace_id IS NOT NULL AND trace_id <> ''
			AND asset_id IS NOT NULL AND asset_id <> ''
			AND linked_export_id IS NOT NULL AND linked_export_id <> ''
			AND quota_bucket_id IS NOT NULL AND quota_bucket_id <> ''
			AND billing_reference_id IS NOT NULL AND billing_reference_id <> ''
		)
		NOT VALID;
END;
$$ LANGUAGE plpgsql;
