-- zenari.ai Stage 1 team and seat billing contracts.
-- Forward-only additive migration. Team seats are billing entitlements and are
-- intentionally tenant-scoped; public brand text remains zenari.ai while the
-- repository keeps lowercase compatibility identifiers until a dedicated rename.

CREATE TABLE IF NOT EXISTS teams (
	id text NOT NULL,
	tenant_id text NOT NULL REFERENCES tenants(id),
	name text NOT NULL,
	plan_id text NOT NULL REFERENCES subscription_plans(id),
	seat_limit integer NOT NULL CHECK (seat_limit > 0),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (id),
	UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS team_members (
	id text NOT NULL,
	team_id text NOT NULL,
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text NOT NULL DEFAULT '',
	email text NOT NULL DEFAULT '',
	role text NOT NULL,
	status text NOT NULL,
	removed_by text NOT NULL DEFAULT '',
	removed_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (id),
	UNIQUE (tenant_id, team_id, id),
	FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id),
	CONSTRAINT team_members_role_check CHECK (role IN ('owner', 'admin', 'member')),
	CONSTRAINT team_members_status_check CHECK (status IN ('active', 'invited', 'removed')),
	CONSTRAINT team_members_identity_check CHECK (user_id <> '' OR email <> ''),
	CONSTRAINT team_members_removed_projection_check CHECK (
		status <> 'removed'
		OR (removed_by <> '' AND removed_at IS NOT NULL)
	)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_active_user
	ON team_members(tenant_id, team_id, user_id)
	WHERE user_id <> '' AND status IN ('active', 'invited');

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_active_email
	ON team_members(tenant_id, team_id, lower(email))
	WHERE email <> '' AND status IN ('active', 'invited');

CREATE TABLE IF NOT EXISTS team_invites (
	id text NOT NULL,
	team_id text NOT NULL,
	tenant_id text NOT NULL REFERENCES tenants(id),
	email text NOT NULL,
	role text NOT NULL,
	idempotency_key text NOT NULL,
	invited_by text NOT NULL,
	accepted_by text NOT NULL DEFAULT '',
	status text NOT NULL DEFAULT 'pending',
	expires_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (id),
	UNIQUE (tenant_id, team_id, idempotency_key),
	FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id),
	CONSTRAINT team_invites_role_check CHECK (role IN ('admin', 'member')),
	CONSTRAINT team_invites_status_check CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
	CONSTRAINT team_invites_accepted_projection_check CHECK (
		status <> 'accepted'
		OR accepted_by <> ''
	)
);

CREATE TABLE IF NOT EXISTS team_billing_links (
	tenant_id text NOT NULL REFERENCES tenants(id),
	team_id text NOT NULL,
	provider text NOT NULL DEFAULT 'stripe',
	provider_subscription_id text NOT NULL,
	provider_subscription_item_id text NOT NULL,
	price_id text NOT NULL DEFAULT '',
	proration_behavior text NOT NULL DEFAULT 'create_prorations',
	status text NOT NULL DEFAULT 'active',
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (tenant_id, team_id, provider_subscription_item_id),
	FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id),
	CONSTRAINT team_billing_links_provider_check CHECK (provider IN ('stripe', 'mock')),
	CONSTRAINT team_billing_links_status_check CHECK (status IN ('active', 'paused', 'removed')),
	CONSTRAINT team_billing_links_proration_check CHECK (
		proration_behavior IN ('create_prorations', 'none', 'always_invoice')
	)
);

CREATE TABLE IF NOT EXISTS team_seat_billing_syncs (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	team_id text NOT NULL,
	provider text NOT NULL DEFAULT '',
	provider_subscription_id text NOT NULL DEFAULT '',
	provider_subscription_item_id text NOT NULL DEFAULT '',
	price_id text NOT NULL DEFAULT '',
	requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
	synced_quantity integer NOT NULL DEFAULT 0 CHECK (synced_quantity >= 0),
	proration_behavior text NOT NULL DEFAULT 'create_prorations',
	status text NOT NULL,
	reason text NOT NULL DEFAULT '',
	operation text NOT NULL,
	idempotency_key text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (tenant_id, team_id, operation, idempotency_key),
	FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id),
	CONSTRAINT team_seat_billing_syncs_status_check CHECK (status IN ('synced', 'skipped', 'failed')),
	CONSTRAINT team_seat_billing_syncs_proration_check CHECK (
		proration_behavior IN ('create_prorations', 'none', 'always_invoice')
	)
);

CREATE INDEX IF NOT EXISTS idx_teams_tenant_plan
	ON teams(tenant_id, plan_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_members_team_status
	ON team_members(tenant_id, team_id, status, role);

CREATE INDEX IF NOT EXISTS idx_team_invites_team_status
	ON team_invites(tenant_id, team_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_team_billing_links_active
	ON team_billing_links(tenant_id, team_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_billing_links_one_active
	ON team_billing_links(tenant_id, team_id)
	WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_team_seat_billing_syncs_team_created
	ON team_seat_billing_syncs(tenant_id, team_id, created_at DESC);

COMMENT ON TABLE teams IS 'Stage 1 tenant-scoped teams with seat limits derived from billing plan entitlements.';
COMMENT ON TABLE team_members IS 'Stage 1 team membership projection. Active and invited rows are billable seats; owner removal is denied in application code.';
COMMENT ON TABLE team_invites IS 'Stage 1 idempotent team invite ledger. Pending invites reserve seats until accepted, revoked, expired, or removed.';
COMMENT ON TABLE team_billing_links IS 'Stage 1 binding between a tenant team and a Stripe subscription item used for seat quantity and proration sync.';
COMMENT ON TABLE team_seat_billing_syncs IS 'Stage 1 idempotent audit ledger for team seat quantity sync attempts to Stripe subscription items.';
