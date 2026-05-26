-- ZenArt Stage 0 Rev2 domain baseline.
-- Migration tool: backend/cmd/migrate custom forward-only SQL runner.
-- Rollback safety: not automatically reversible; dropping these tables would destroy
-- user/project/provenance data. Use restore-from-backup or a reviewed contract
-- migration for production rollback.
-- Expand/contract policy: new columns are nullable or defaulted first, indexes are
-- additive, enum-like values are stored as text and constrained at the application
-- contract layer until all workers are upgraded.

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS progress numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100);
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0);
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS timeout_at timestamptz;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS user_message text NOT NULL DEFAULT '';
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS app_version text NOT NULL DEFAULT 'stage0-local';
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS worker_version text NOT NULL DEFAULT 'stage0-local';
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE TABLE IF NOT EXISTS projects (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	owner_id text NOT NULL REFERENCES users(id),
	name text NOT NULL,
	status text NOT NULL DEFAULT 'active',
	workflow_id text NOT NULL DEFAULT '',
	brief text NOT NULL DEFAULT '',
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	project_id text NOT NULL REFERENCES projects(id),
	name text NOT NULL,
	active_canvas_version_id text,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canvas_versions (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	workspace_id text NOT NULL REFERENCES workspaces(id),
	version_number integer NOT NULL CHECK (version_number > 0),
	label text NOT NULL DEFAULT '',
	snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_by text NOT NULL REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, version_number)
);

CREATE TABLE IF NOT EXISTS canvas_frames (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	workspace_id text NOT NULL REFERENCES workspaces(id),
	version_id text REFERENCES canvas_versions(id),
	name text NOT NULL,
	x numeric NOT NULL DEFAULT 0,
	y numeric NOT NULL DEFAULT 0,
	width numeric NOT NULL DEFAULT 1080,
	height numeric NOT NULL DEFAULT 1080,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canvas_nodes (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	workspace_id text NOT NULL REFERENCES workspaces(id),
	frame_id text REFERENCES canvas_frames(id),
	version_id text REFERENCES canvas_versions(id),
	node_type text NOT NULL,
	title text NOT NULL DEFAULT '',
	body jsonb NOT NULL DEFAULT '{}'::jsonb,
	x numeric NOT NULL DEFAULT 0,
	y numeric NOT NULL DEFAULT 0,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canvas_edges (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	workspace_id text NOT NULL REFERENCES workspaces(id),
	version_id text REFERENCES canvas_versions(id),
	from_node_id text NOT NULL REFERENCES canvas_nodes(id),
	to_node_id text NOT NULL REFERENCES canvas_nodes(id),
	edge_type text NOT NULL DEFAULT 'derived_from',
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	project_id text NOT NULL REFERENCES projects(id),
	user_id text NOT NULL REFERENCES users(id),
	status text NOT NULL DEFAULT 'open',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	chat_session_id text NOT NULL REFERENCES chat_sessions(id),
	role text NOT NULL,
	body text NOT NULL,
	provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_sets (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	project_id text NOT NULL REFERENCES projects(id),
	task_id text REFERENCES agent_tasks(id),
	workflow_id text NOT NULL,
	status text NOT NULL DEFAULT 'pending',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_assets (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	candidate_set_id text NOT NULL REFERENCES candidate_sets(id),
	project_id text NOT NULL REFERENCES projects(id),
	asset_kind text NOT NULL,
	status text NOT NULL DEFAULT 'candidate',
	provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
	provider_id text NOT NULL DEFAULT '',
	model_id text NOT NULL DEFAULT '',
	endpoint_version text NOT NULL DEFAULT '',
	request_hash text NOT NULL DEFAULT '',
	cost_estimate jsonb NOT NULL DEFAULT '{}'::jsonb,
	actual_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
	qa_status text NOT NULL DEFAULT 'pending',
	trace_id text REFERENCES agent_traces(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS selected_directions (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	project_id text NOT NULL REFERENCES projects(id),
	candidate_asset_id text NOT NULL REFERENCES candidate_assets(id),
	selected_by text NOT NULL REFERENCES users(id),
	rationale text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (project_id, candidate_asset_id)
);

CREATE TABLE IF NOT EXISTS uploads (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	project_id text REFERENCES projects(id),
	user_id text NOT NULL REFERENCES users(id),
	upload_type text NOT NULL,
	status text NOT NULL DEFAULT 'pending',
	original_filename text NOT NULL DEFAULT '',
	content_type text NOT NULL DEFAULT '',
	byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS object_metadata (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	upload_id text REFERENCES uploads(id),
	bucket text NOT NULL,
	object_key text NOT NULL,
	content_type text NOT NULL DEFAULT '',
	byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
	checksum text NOT NULL DEFAULT '',
	retention_until timestamptz,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (bucket, object_key)
);

CREATE TABLE IF NOT EXISTS assets (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	project_id text REFERENCES projects(id),
	object_metadata_id text REFERENCES object_metadata(id),
	candidate_asset_id text REFERENCES candidate_assets(id),
	asset_type text NOT NULL,
	status text NOT NULL DEFAULT 'active',
	provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS packages (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	project_id text NOT NULL REFERENCES projects(id),
	created_by text NOT NULL REFERENCES users(id),
	status text NOT NULL DEFAULT 'draft',
	manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_items (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	package_id text NOT NULL REFERENCES packages(id),
	asset_id text REFERENCES assets(id),
	canvas_frame_id text REFERENCES canvas_frames(id),
	item_type text NOT NULL,
	sort_order integer NOT NULL DEFAULT 0,
	provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exports (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	package_id text NOT NULL REFERENCES packages(id),
	task_id text REFERENCES agent_tasks(id),
	format text NOT NULL,
	status text NOT NULL DEFAULT 'pending',
	qa_status text NOT NULL DEFAULT 'pending',
	object_metadata_id text REFERENCES object_metadata(id),
	error jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_links (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	project_id text NOT NULL REFERENCES projects(id),
	export_id text REFERENCES exports(id),
	token_hash text NOT NULL UNIQUE,
	scope text NOT NULL DEFAULT 'private',
	expires_at timestamptz,
	revoked_at timestamptz,
	created_by text NOT NULL REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_link_access_logs (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	share_link_id text NOT NULL REFERENCES share_links(id),
	actor_id text,
	ip_hash text NOT NULL DEFAULT '',
	user_agent text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skills (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	name text NOT NULL,
	domain text NOT NULL,
	owner text NOT NULL,
	risk_level text NOT NULL DEFAULT 'medium',
	status text NOT NULL DEFAULT 'draft',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_versions (
	id text PRIMARY KEY,
	skill_id text NOT NULL REFERENCES skills(id),
	version text NOT NULL,
	status text NOT NULL DEFAULT 'review',
	eval_suite_id text,
	safety_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
	release_notes text NOT NULL DEFAULT '',
	rollback_target_version_id text,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (skill_id, version)
);

CREATE TABLE IF NOT EXISTS skill_sources (
	id text PRIMARY KEY,
	skill_id text NOT NULL REFERENCES skills(id),
	source_type text NOT NULL,
	source_ref text NOT NULL,
	provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_release_channels (
	id text PRIMARY KEY,
	skill_id text NOT NULL REFERENCES skills(id),
	channel text NOT NULL,
	active_version_id text REFERENCES skill_versions(id),
	canary_percent integer NOT NULL DEFAULT 0 CHECK (canary_percent >= 0 AND canary_percent <= 100),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (skill_id, channel)
);

CREATE TABLE IF NOT EXISTS skill_usage_stats (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	skill_version_id text NOT NULL REFERENCES skill_versions(id),
	day date NOT NULL,
	usage_count bigint NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
	success_count bigint NOT NULL DEFAULT 0 CHECK (success_count >= 0),
	failure_count bigint NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
	cost_units bigint NOT NULL DEFAULT 0 CHECK (cost_units >= 0),
	UNIQUE (tenant_id, skill_version_id, day)
);

CREATE TABLE IF NOT EXISTS prompt_fragments (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	name text NOT NULL,
	surface text NOT NULL DEFAULT 'prompt-fragment',
	status text NOT NULL DEFAULT 'draft',
	owner text NOT NULL,
	risk_level text NOT NULL DEFAULT 'medium',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fragment_versions (
	id text PRIMARY KEY,
	fragment_id text NOT NULL REFERENCES prompt_fragments(id),
	version text NOT NULL,
	body text NOT NULL,
	eval_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
	provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (fragment_id, version)
);

CREATE TABLE IF NOT EXISTS mutations (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	fragment_id text REFERENCES prompt_fragments(id),
	source_feedback_event_id text,
	mutation_type text NOT NULL,
	diff jsonb NOT NULL DEFAULT '{}'::jsonb,
	status text NOT NULL DEFAULT 'proposed',
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mutation_reviews (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	mutation_id text NOT NULL REFERENCES mutations(id),
	reviewer_id text NOT NULL REFERENCES users(id),
	decision text NOT NULL,
	rationale text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meta_prompts (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	name text NOT NULL,
	status text NOT NULL DEFAULT 'draft',
	owner text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meta_prompt_versions (
	id text PRIMARY KEY,
	meta_prompt_id text NOT NULL REFERENCES meta_prompts(id),
	version text NOT NULL,
	body text NOT NULL,
	provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (meta_prompt_id, version)
);

CREATE TABLE IF NOT EXISTS image_specs (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	name text NOT NULL,
	status text NOT NULL DEFAULT 'draft',
	schema jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spec_instances (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	image_spec_id text NOT NULL REFERENCES image_specs(id),
	project_id text REFERENCES projects(id),
	payload jsonb NOT NULL DEFAULT '{}'::jsonb,
	schema_version integer NOT NULL DEFAULT 1,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spec_evaluations (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	spec_instance_id text NOT NULL REFERENCES spec_instances(id),
	evaluator text NOT NULL,
	status text NOT NULL,
	findings jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_suites (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	name text NOT NULL,
	version text NOT NULL,
	status text NOT NULL DEFAULT 'draft',
	blueprint_ref text NOT NULL DEFAULT 'Docs/stage0_blueprint_rev2.md',
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS eval_fixtures (
	id text PRIMARY KEY,
	eval_suite_id text NOT NULL REFERENCES eval_suites(id),
	fixture_type text NOT NULL,
	workflow_id text NOT NULL DEFAULT '',
	payload jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_results (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	eval_suite_id text NOT NULL REFERENCES eval_suites(id),
	subject_type text NOT NULL,
	subject_id text NOT NULL,
	subject_version text NOT NULL DEFAULT '',
	status text NOT NULL,
	summary jsonb NOT NULL DEFAULT '{}'::jsonb,
	runner text NOT NULL DEFAULT '',
	runner_sha256 text NOT NULL DEFAULT '',
	completed_at timestamptz NOT NULL DEFAULT now(),
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_results_tenant_suite_subject_created_at
	ON eval_results(tenant_id, eval_suite_id, subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_results_subject_status_completed_at
	ON eval_results(subject_type, subject_id, status, completed_at DESC);

CREATE TABLE IF NOT EXISTS crawler_sources (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	name text NOT NULL,
	url text NOT NULL,
	approval_status text NOT NULL DEFAULT 'pending',
	legal_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	robots_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawler_runs (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	source_id text NOT NULL REFERENCES crawler_sources(id),
	status text NOT NULL DEFAULT 'queued',
	started_at timestamptz,
	completed_at timestamptz,
	summary jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawler_documents (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	run_id text NOT NULL REFERENCES crawler_runs(id),
	source_id text NOT NULL REFERENCES crawler_sources(id),
	url text NOT NULL,
	content_hash text NOT NULL,
	retention_until timestamptz,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (source_id, content_hash)
);

CREATE TABLE IF NOT EXISTS crawler_findings (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	document_id text NOT NULL REFERENCES crawler_documents(id),
	finding_type text NOT NULL,
	status text NOT NULL DEFAULT 'pending_review',
	payload jsonb NOT NULL DEFAULT '{}'::jsonb,
	provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawler_import_reviews (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	finding_id text NOT NULL REFERENCES crawler_findings(id),
	reviewer_id text REFERENCES users(id),
	decision text NOT NULL,
	rationale text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_plans (
	id text PRIMARY KEY,
	name text NOT NULL,
	status text NOT NULL DEFAULT 'active',
	monthly_quota_units bigint NOT NULL CHECK (monthly_quota_units >= 0),
	price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
	currency text NOT NULL DEFAULT 'USD',
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text NOT NULL REFERENCES users(id),
	plan_id text NOT NULL REFERENCES subscription_plans(id),
	status text NOT NULL DEFAULT 'trialing',
	current_period_start timestamptz NOT NULL DEFAULT now(),
	current_period_end timestamptz,
	provider text NOT NULL DEFAULT 'local',
	provider_ref text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_usage_logs (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text REFERENCES users(id),
	project_id text REFERENCES projects(id),
	task_id text REFERENCES agent_tasks(id),
	provider_id text NOT NULL,
	model_id text NOT NULL,
	endpoint_version text NOT NULL DEFAULT '',
	request_hash text NOT NULL DEFAULT '',
	usage_units bigint NOT NULL DEFAULT 0 CHECK (usage_units >= 0),
	cost_cents integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
	status text NOT NULL DEFAULT 'recorded',
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_events (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text REFERENCES users(id),
	project_id text REFERENCES projects(id),
	event_type text NOT NULL,
	subject_type text NOT NULL,
	subject_id text NOT NULL,
	signal jsonb NOT NULL DEFAULT '{}'::jsonb,
	governance jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_labels (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	feedback_event_id text NOT NULL REFERENCES feedback_events(id),
	label text NOT NULL,
	applied_by text REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_performance_daily (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	day date NOT NULL,
	workflow_id text NOT NULL,
	metric_name text NOT NULL,
	metric_value numeric NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (tenant_id, day, workflow_id, metric_name)
);

CREATE TABLE IF NOT EXISTS safety_rules (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	rule_key text NOT NULL,
	version text NOT NULL,
	domain text NOT NULL,
	severity text NOT NULL,
	action text NOT NULL,
	enforcement_points jsonb NOT NULL DEFAULT '[]'::jsonb,
	status text NOT NULL DEFAULT 'draft',
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (rule_key, version)
);

CREATE TABLE IF NOT EXISTS safety_decisions (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	rule_id text REFERENCES safety_rules(id),
	subject_type text NOT NULL,
	subject_id text NOT NULL,
	enforcement_point text NOT NULL,
	decision text NOT NULL,
	rationale text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qa_results (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	project_id text REFERENCES projects(id),
	subject_type text NOT NULL,
	subject_id text NOT NULL,
	severity text NOT NULL,
	status text NOT NULL,
	findings jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text NOT NULL REFERENCES users(id),
	project_id text REFERENCES projects(id),
	task_id text REFERENCES agent_tasks(id),
	trace_id text REFERENCES agent_traces(id),
	asset_id text REFERENCES assets(id),
	category text NOT NULL,
	status text NOT NULL DEFAULT 'open',
	body text NOT NULL,
	linked_export_id text REFERENCES exports(id),
	quota_bucket_id text REFERENCES quota_buckets(id),
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS abuse_events (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text REFERENCES users(id),
	event_type text NOT NULL,
	severity text NOT NULL,
	status text NOT NULL DEFAULT 'open',
	evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
	controls jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_logs (
	id text PRIMARY KEY,
	tenant_id text REFERENCES tenants(id),
	severity text NOT NULL,
	status text NOT NULL DEFAULT 'open',
	title text NOT NULL,
	description text NOT NULL DEFAULT '',
	owner text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_owner ON projects(tenant_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_workspace ON canvas_nodes(tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(tenant_id, chat_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_tenant_status ON agent_tasks(tenant_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_traces_task ON agent_traces(tenant_id, task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_candidate_assets_project ON candidate_assets(tenant_id, project_id, qa_status);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_exports_package ON exports(tenant_id, package_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_events_subject ON feedback_events(tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_provider_usage_task ON provider_usage_logs(tenant_id, task_id);
CREATE INDEX IF NOT EXISTS idx_safety_decisions_subject ON safety_decisions(tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status ON support_tickets(tenant_id, status, updated_at);

INSERT INTO tenants(id, name) VALUES
	('tenant_local', 'Local Development Tenant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users(id, tenant_id, email, display_name) VALUES
	('user_local_admin', 'tenant_local', 'admin@zenart.local', 'Local Admin'),
	('user_local_user', 'tenant_local', 'user@zenart.local', 'Local User')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles(user_id, role_name) VALUES
	('user_local_admin', 'admin'),
	('user_local_admin', 'user'),
	('user_local_user', 'user')
ON CONFLICT (user_id, role_name) DO NOTHING;

INSERT INTO subscription_plans(id, name, status, monthly_quota_units, price_cents, currency, metadata) VALUES
	('plan_default_local', 'Default Local Plan', 'active', 1000, 0, 'USD', '{"stage":"stage0_rev2"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_subscriptions(id, tenant_id, user_id, plan_id, status, provider) VALUES
	('sub_local_user', 'tenant_local', 'user_local_user', 'plan_default_local', 'trialing', 'local'),
	('sub_local_admin', 'tenant_local', 'user_local_admin', 'plan_default_local', 'trialing', 'local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO quota_buckets(id, tenant_id, subject_type, subject_id, period, limit_units, resets_at) VALUES
	('quota_local_user_monthly', 'tenant_local', 'user', 'user_local_user', 'monthly', 1000, now() + interval '30 days'),
	('quota_local_admin_monthly', 'tenant_local', 'user', 'user_local_admin', 'monthly', 1000, now() + interval '30 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO skills(id, tenant_id, name, domain, owner, risk_level, status) VALUES
	('skill_internal_workflow_planner', NULL, 'Internal Workflow Planner', 'agent_planning', 'platform', 'medium', 'draft'),
	('skill_internal_export_builder', NULL, 'Internal Export Builder', 'packaging', 'platform', 'medium', 'draft')
ON CONFLICT (id) DO NOTHING;

INSERT INTO skill_versions(id, skill_id, version, status, release_notes) VALUES
	('skillver_internal_workflow_planner_001', 'skill_internal_workflow_planner', '0.0.1', 'review', 'Stage 0 local seed; not production-active.'),
	('skillver_internal_export_builder_001', 'skill_internal_export_builder', '0.0.1', 'review', 'Stage 0 local seed; not production-active.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO eval_suites(id, tenant_id, name, version, status) VALUES
	('eval_stage0_rev2_starter', NULL, 'Stage 0 Rev2 Starter Eval Suite', '0.0.1', 'draft')
ON CONFLICT (id) DO NOTHING;

INSERT INTO safety_rules(id, tenant_id, rule_key, version, domain, severity, action, enforcement_points, status) VALUES
	('safety_stage0_runtime_allow_v1', NULL, 'stage0_runtime_policy', '1', 'stage0', 'info', 'allow', '["brief","provider_request","provider_response","qa","export"]'::jsonb, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects(id, tenant_id, owner_id, name, status, workflow_id, brief) VALUES
	('project_local_ecommerce_growth', 'tenant_local', 'user_local_user', 'Local Ecommerce Growth Fixture', 'active', 'ecommerce_growth_pack', 'Local seed project for ecommerce growth workflow.'),
	('project_local_business_doc', 'tenant_local', 'user_local_user', 'Local Business Visual Doc Fixture', 'active', 'business_visual_doc_pack', 'Local seed project for business visual document workflow.'),
	('project_local_merchant_campaign', 'tenant_local', 'user_local_user', 'Local Merchant Campaign Fixture', 'active', 'local_merchant_campaign_pack', 'Local seed project for local merchant campaign workflow.'),
	('project_local_character_ip', 'tenant_local', 'user_local_user', 'Local Character IP Fixture', 'active', 'character_ip_concept_pack', 'Local seed project for character IP concept workflow.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crawler_sources(id, tenant_id, name, url, approval_status, legal_metadata, robots_policy) VALUES
	('crawler_source_stage0_allowed', NULL, 'Stage 0 Allowed Test Source', 'https://example.com/zenart-stage0', 'approved', '{"license":"test-fixture","owner":"platform"}'::jsonb, '{"robots":"allowed","direct_activation_allowed":false}'::jsonb)
ON CONFLICT (id) DO NOTHING;
