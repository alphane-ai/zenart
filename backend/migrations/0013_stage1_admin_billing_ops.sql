-- zenari.ai Stage 1 admin billing operations contracts.

CREATE TABLE IF NOT EXISTS billing_admin_operations (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	actor_id text NOT NULL,
	target_user_id text NOT NULL REFERENCES users(id),
	operation text NOT NULL,
	idempotency_key text NOT NULL,
	status text NOT NULL DEFAULT 'pending',
	units bigint NOT NULL DEFAULT 0 CHECK (units >= 0),
	bucket_id text NOT NULL DEFAULT '',
	subscription_id text NOT NULL DEFAULT '',
	provider text NOT NULL DEFAULT '',
	provider_ref text NOT NULL DEFAULT '',
	rationale text NOT NULL,
	note text NOT NULL DEFAULT '',
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (tenant_id, operation, idempotency_key),
	CONSTRAINT billing_admin_operations_operation_check CHECK (
		operation IN ('manual_credit', 'refund_note', 'sync_subscription', 'account_lock')
	),
	CONSTRAINT billing_admin_operations_status_check CHECK (
		status IN ('pending', 'recorded', 'succeeded', 'failed')
	),
	CONSTRAINT billing_admin_operations_manual_credit_check CHECK (
		operation != 'manual_credit'
		OR (units > 0 AND bucket_id <> '')
	)
);

CREATE INDEX IF NOT EXISTS idx_billing_admin_operations_tenant_created
	ON billing_admin_operations(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_admin_operations_target_user
	ON billing_admin_operations(tenant_id, target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_account_locks (
	tenant_id text NOT NULL REFERENCES tenants(id),
	user_id text NOT NULL REFERENCES users(id),
	locked boolean NOT NULL DEFAULT false,
	reason text NOT NULL,
	locked_by text NOT NULL,
	locked_at timestamptz NOT NULL DEFAULT now(),
	unlocked_at timestamptz,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_account_locks_active
	ON billing_account_locks(tenant_id, locked, updated_at DESC);

COMMENT ON TABLE billing_admin_operations IS 'Stage 1 admin billing operation ledger for manual credit, refund note, subscription sync, and account lock control-plane actions. Metadata is redacted before persistence.';
COMMENT ON TABLE billing_account_locks IS 'Stage 1 tenant-scoped billing/account lock projection updated through audited admin billing operations.';
