-- Stage 0 Rev2 server-side analytics capture.
-- Additive, tenant-scoped event ledger for core workflow events captured by the
-- backend. Properties are redacted by application code before persistence.

CREATE TABLE IF NOT EXISTS analytics_events (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text REFERENCES users(id),
	project_id text REFERENCES projects(id),
	workflow_id text NOT NULL DEFAULT '',
	event_name text NOT NULL,
	subject_type text NOT NULL,
	subject_id text NOT NULL,
	properties jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_created ON analytics_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_workflow_name ON analytics_events(tenant_id, workflow_id, event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_subject ON analytics_events(tenant_id, subject_type, subject_id);
