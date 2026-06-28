CREATE TABLE IF NOT EXISTS safety_review_decisions (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenants(id),
	safety_decision_id text NOT NULL REFERENCES safety_decisions(id),
	reviewer_id text NOT NULL,
	decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'escalated', 'blocked')),
	rationale text NOT NULL,
	audit_ref text NOT NULL,
	idempotency_key text NOT NULL,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (tenant_id, idempotency_key),
	UNIQUE (tenant_id, safety_decision_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_safety_review_decisions_tenant_created
	ON safety_review_decisions(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_safety_review_decisions_safety_decision
	ON safety_review_decisions(tenant_id, safety_decision_id);
