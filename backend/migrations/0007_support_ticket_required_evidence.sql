-- Enforce the Stage 0 Rev2 support evidence contract for new tickets.
-- Constraints are NOT VALID so pre-existing local/staging rows can be backfilled
-- before validation while all future inserts/updates are guarded.

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'chk_support_tickets_required_evidence'
		  AND conrelid = 'support_tickets'::regclass
	) THEN
		ALTER TABLE support_tickets
			ADD CONSTRAINT chk_support_tickets_required_evidence
			CHECK (
				tenant_id <> ''
				AND user_id <> ''
				AND project_id IS NOT NULL AND project_id <> ''
				AND task_id IS NOT NULL AND task_id <> ''
				AND trace_id IS NOT NULL AND trace_id <> ''
				AND asset_id IS NOT NULL AND asset_id <> ''
				AND linked_export_id IS NOT NULL AND linked_export_id <> ''
				AND quota_bucket_id IS NOT NULL AND quota_bucket_id <> ''
			)
			NOT VALID;
	END IF;
END;
$$ LANGUAGE plpgsql;
