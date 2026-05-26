CREATE TABLE IF NOT EXISTS tenants (
	id text PRIMARY KEY,
	name text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	email text NOT NULL UNIQUE,
	display_name text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
	id text PRIMARY KEY,
	user_id text NOT NULL REFERENCES users(id),
	tenant_id text NOT NULL REFERENCES tenants(id),
	expires_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
	name text PRIMARY KEY,
	description text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_roles (
	user_id text NOT NULL REFERENCES users(id),
	role_name text NOT NULL REFERENCES roles(name),
	PRIMARY KEY (user_id, role_name)
);

CREATE TABLE IF NOT EXISTS audit_logs (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	actor_id text NOT NULL,
	action text NOT NULL,
	resource text NOT NULL,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quota_buckets (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	subject_type text NOT NULL,
	subject_id text NOT NULL,
	period text NOT NULL,
	limit_units bigint NOT NULL CHECK (limit_units >= 0),
	used_units bigint NOT NULL DEFAULT 0 CHECK (used_units >= 0),
	reserved_units bigint NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
	resets_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (tenant_id, subject_type, subject_id, period)
);

CREATE TABLE IF NOT EXISTS quota_transactions (
	id text PRIMARY KEY,
	bucket_id text NOT NULL REFERENCES quota_buckets(id),
	tenant_id text NOT NULL REFERENCES tenants(id),
	idempotency_key text NOT NULL,
	kind text NOT NULL,
	units bigint NOT NULL CHECK (units >= 0),
	status text NOT NULL,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (tenant_id, idempotency_key, kind)
);

CREATE TABLE IF NOT EXISTS subscriptions (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text NOT NULL REFERENCES users(id),
	state text NOT NULL,
	provider text NOT NULL,
	provider_ref text NOT NULL DEFAULT '',
	current_period_end timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_tasks (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	type text NOT NULL,
	schema_version integer NOT NULL,
	status text NOT NULL,
	user_status text NOT NULL,
	idempotency_key text NOT NULL DEFAULT '',
	error jsonb,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_traces (
	id text PRIMARY KEY,
	task_id text NOT NULL REFERENCES agent_tasks(id),
	tenant_id text NOT NULL REFERENCES tenants(id),
	step_name text NOT NULL,
	payload jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles(name, description) VALUES
	('user', 'Default web user'),
	('admin', 'Administrative operator')
ON CONFLICT (name) DO NOTHING;
