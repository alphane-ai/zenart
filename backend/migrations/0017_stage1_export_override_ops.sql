CREATE TABLE IF NOT EXISTS export_override_decisions (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    export_id text NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    trace_id text NOT NULL,
    requested_by text NOT NULL,
    requested_by_role text NOT NULL,
    resolved_by text NOT NULL,
    resolved_by_role text NOT NULL,
    outcome text NOT NULL,
    denial_reason text,
    source_gate_resolved boolean NOT NULL DEFAULT false,
    final_export_allowed boolean NOT NULL DEFAULT false,
    rationale text NOT NULL,
    audit_log_id text NOT NULL,
    idempotency_key text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key),
    CHECK (source_type IN ('qa_result', 'safety_decision', 'export_contract')),
    CHECK (outcome IN ('approved', 'denied')),
    CHECK (denial_reason IS NULL OR denial_reason IN ('source_not_override_eligible', 'critical_safety_rule', 'incomplete_export_artifacts', 'missing_approval_audit'))
);

CREATE INDEX IF NOT EXISTS export_override_decisions_tenant_export_created_idx
    ON export_override_decisions (tenant_id, export_id, created_at DESC);
