-- zenari.ai Stage 1 Stripe checkout and webhook idempotency contracts.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
	id text PRIMARY KEY,
	type text NOT NULL,
	livemode boolean NOT NULL,
	tenant_id text NOT NULL,
	user_id text NOT NULL,
	provider_customer_id text NOT NULL DEFAULT '',
	provider_subscription_id text NOT NULL DEFAULT '',
	payload jsonb NOT NULL DEFAULT '{}'::jsonb,
	status text NOT NULL DEFAULT 'received',
	subscription_status text NOT NULL DEFAULT '',
	received_at timestamptz NOT NULL DEFAULT now(),
	processed_at timestamptz,
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT stripe_webhook_events_status_check CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
	CONSTRAINT stripe_webhook_events_subscription_status_check CHECK (
		subscription_status = ''
		OR subscription_status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired', 'comped')
	)
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_tenant_received ON stripe_webhook_events(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_subscription ON stripe_webhook_events(provider_subscription_id, updated_at DESC);
