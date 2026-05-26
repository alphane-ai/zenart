-- Add support ticket evidence links required by Stage 0 Rev2 support flows.
-- Columns are nullable so existing support records remain valid; tenant-scoped
-- foreign keys are added here for databases that already applied 0005.

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS task_id text;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS trace_id text;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS asset_id text;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS quota_bucket_id text;

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_project ON support_tickets(tenant_id, project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_task ON support_tickets(tenant_id, task_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_trace ON support_tickets(tenant_id, trace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_asset ON support_tickets(tenant_id, asset_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_export ON support_tickets(tenant_id, linked_export_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_quota ON support_tickets(tenant_id, quota_bucket_id, updated_at);

CREATE OR REPLACE FUNCTION add_support_ticket_tenant_fk_if_missing(
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

SELECT add_support_ticket_tenant_fk_if_missing('fk_support_tickets_tenant_task', 'tenant_id, task_id', 'agent_tasks', 'tenant_id, id');
SELECT add_support_ticket_tenant_fk_if_missing('fk_support_tickets_tenant_trace', 'tenant_id, trace_id', 'agent_traces', 'tenant_id, id');
SELECT add_support_ticket_tenant_fk_if_missing('fk_support_tickets_tenant_asset', 'tenant_id, asset_id', 'assets', 'tenant_id, id');
SELECT add_support_ticket_tenant_fk_if_missing('fk_support_tickets_tenant_quota', 'tenant_id, quota_bucket_id', 'quota_buckets', 'tenant_id, id');

DROP FUNCTION add_support_ticket_tenant_fk_if_missing(text, text, text, text);
