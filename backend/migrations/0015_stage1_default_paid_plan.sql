-- zenari.ai Stage 1 default paid checkout plan.
-- Keeps the product default checkout plan, Stripe lifecycle smoke default, and
-- subscription foreign key seed aligned for local/staging paid billing flows.

INSERT INTO subscription_plans(id, name, status, monthly_quota_units, price_cents, currency, metadata) VALUES
	(
		'plan_pro',
		'Zenari Pro',
		'active',
		5000,
		1900,
		'USD',
		'{"stage":"stage1","billing_provider":"stripe","default_checkout_plan":true}'::jsonb
	)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    status = EXCLUDED.status,
    monthly_quota_units = EXCLUDED.monthly_quota_units,
    price_cents = EXCLUDED.price_cents,
    currency = EXCLUDED.currency,
    metadata = subscription_plans.metadata || EXCLUDED.metadata,
    updated_at = now();
