-- zenari.ai Stage 1 provider usage task-reference repair.
-- Provider usage can originate from legacy agent_tasks or Stage 1 generation
-- child tasks. Preserve tenant/task integrity with a typed trigger instead of
-- a single-table FK that rejects batch child usage.

ALTER TABLE provider_usage_logs
	ADD COLUMN IF NOT EXISTS task_ref_type text NOT NULL DEFAULT 'agent_task';

ALTER TABLE provider_usage_logs
	DROP CONSTRAINT IF EXISTS provider_usage_logs_task_id_fkey;

ALTER TABLE provider_usage_logs
	DROP CONSTRAINT IF EXISTS fk_provider_usage_logs_tenant_task;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'provider_usage_logs_task_ref_type_check'
		  AND conrelid = 'provider_usage_logs'::regclass
	) THEN
		ALTER TABLE provider_usage_logs
			ADD CONSTRAINT provider_usage_logs_task_ref_type_check
			CHECK (task_ref_type IN ('agent_task', 'generation_child_task'));
	END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_provider_usage_task_ref
	ON provider_usage_logs(tenant_id, task_ref_type, task_id);

CREATE OR REPLACE FUNCTION validate_provider_usage_logs_task_ref()
RETURNS trigger AS $$
BEGIN
	IF NEW.task_id IS NULL OR btrim(NEW.task_id) = '' THEN
		RAISE EXCEPTION 'provider_usage_logs.task_id is required'
			USING ERRCODE = '23514';
	END IF;

	IF NEW.task_ref_type = 'agent_task' THEN
		IF NOT EXISTS (
			SELECT 1
			FROM agent_tasks
			WHERE tenant_id = NEW.tenant_id
			  AND id = NEW.task_id
		) THEN
			RAISE EXCEPTION 'provider_usage_logs agent task reference missing for tenant %, task %', NEW.tenant_id, NEW.task_id
				USING ERRCODE = '23503';
		END IF;
	ELSIF NEW.task_ref_type = 'generation_child_task' THEN
		IF NOT EXISTS (
			SELECT 1
			FROM generation_child_tasks
			WHERE tenant_id = NEW.tenant_id
			  AND id = NEW.task_id
		) THEN
			RAISE EXCEPTION 'provider_usage_logs generation child reference missing for tenant %, task %', NEW.tenant_id, NEW.task_id
				USING ERRCODE = '23503';
		END IF;
	ELSE
		RAISE EXCEPTION 'unsupported provider_usage_logs.task_ref_type %', NEW.task_ref_type
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS provider_usage_logs_validate_task_ref ON provider_usage_logs;

CREATE TRIGGER provider_usage_logs_validate_task_ref
	BEFORE INSERT OR UPDATE OF tenant_id, task_id, task_ref_type
	ON provider_usage_logs
	FOR EACH ROW
	EXECUTE FUNCTION validate_provider_usage_logs_task_ref();

COMMENT ON COLUMN provider_usage_logs.task_ref_type IS 'Task reference table for task_id: agent_task for legacy agent tasks or generation_child_task for Stage 1 batch children.';
