-- Stage 0 Rev2 export failure analytics capture.
-- Storage-bound triggers cover failed/blocked export transitions so worker,
-- admin, and direct storage paths all preserve failure metrics even when the
-- caller did not go through Repository.RecordAnalyticsEvent. Properties
-- intentionally avoid raw error payloads, signed URLs, and manifests.

CREATE OR REPLACE FUNCTION stage0_export_status_analytics_event_name(input_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT CASE lower(trim(COALESCE(input_status, '')))
		WHEN 'failed' THEN 'export_failed'
		WHEN 'blocked' THEN 'export_failed'
		ELSE ''
	END
$$;

CREATE OR REPLACE FUNCTION stage0_export_status_analytics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	event_name text;
	package_user_id text;
	workflow_id text;
	status_changed boolean;
BEGIN
	event_name := stage0_export_status_analytics_event_name(NEW.status);
	IF event_name = '' THEN
		RETURN NEW;
	END IF;

	status_changed := TG_OP = 'INSERT' OR COALESCE(OLD.status, '') IS DISTINCT FROM COALESCE(NEW.status, '');
	IF NOT status_changed THEN
		RETURN NEW;
	END IF;

	SELECT p.created_by, pr.workflow_id
	INTO package_user_id, workflow_id
	FROM packages p
	LEFT JOIN projects pr ON pr.tenant_id = p.tenant_id AND pr.id = COALESCE(NEW.project_id, p.project_id)
	WHERE p.tenant_id = NEW.tenant_id
	  AND p.id = NEW.package_id;

	INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
	SELECT
		'analytics_' || md5(NEW.tenant_id || ':' || NEW.id || ':' || event_name),
		NEW.tenant_id,
		package_user_id,
		NEW.project_id,
		COALESCE(workflow_id, ''),
		event_name,
		'export',
		NEW.id,
		jsonb_strip_nulls(jsonb_build_object(
			'package_id', NEW.package_id,
			'task_id', COALESCE(NEW.task_id, ''),
			'format', NEW.format,
			'status', NEW.status,
			'qa_status', NEW.qa_status,
			'object_metadata_id', COALESCE(NEW.object_metadata_id, ''),
			'has_error', NEW.error IS NOT NULL AND NEW.error <> '{}'::jsonb,
			'has_manifest', NEW.manifest IS NOT NULL AND NEW.manifest <> '{}'::jsonb,
			'has_delivery_metadata', NEW.delivery_metadata IS NOT NULL AND NEW.delivery_metadata <> '{}'::jsonb,
			'transition_source', 'storage_trigger'
		)),
		COALESCE(NEW.updated_at, NEW.created_at, now())
	WHERE NOT EXISTS (
		SELECT 1
		FROM analytics_events ae
		WHERE ae.tenant_id = NEW.tenant_id
		  AND ae.event_name = event_name
		  AND ae.subject_type = 'export'
		  AND ae.subject_id = NEW.id
	);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exports_stage0_status_analytics_update ON exports;
CREATE TRIGGER exports_stage0_status_analytics_update
AFTER UPDATE OF status ON exports
FOR EACH ROW EXECUTE FUNCTION stage0_export_status_analytics();

INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
SELECT
	'analytics_' || md5(e.tenant_id || ':' || e.id || ':' || stage0_export_status_analytics_event_name(e.status)),
	e.tenant_id,
	p.created_by,
	e.project_id,
	COALESCE(pr.workflow_id, ''),
	stage0_export_status_analytics_event_name(e.status),
	'export',
	e.id,
	jsonb_strip_nulls(jsonb_build_object(
		'package_id', e.package_id,
		'task_id', COALESCE(e.task_id, ''),
		'format', e.format,
		'status', e.status,
		'qa_status', e.qa_status,
		'object_metadata_id', COALESCE(e.object_metadata_id, ''),
		'has_error', e.error IS NOT NULL AND e.error <> '{}'::jsonb,
		'has_manifest', e.manifest IS NOT NULL AND e.manifest <> '{}'::jsonb,
		'has_delivery_metadata', e.delivery_metadata IS NOT NULL AND e.delivery_metadata <> '{}'::jsonb,
		'transition_source', 'migration_backfill',
		'backfilled', true
	)),
	COALESCE(e.updated_at, e.created_at, now())
FROM exports e
LEFT JOIN packages p ON p.tenant_id = e.tenant_id AND p.id = e.package_id
LEFT JOIN projects pr ON pr.tenant_id = e.tenant_id AND pr.id = COALESCE(e.project_id, p.project_id)
WHERE stage0_export_status_analytics_event_name(e.status) <> ''
  AND NOT EXISTS (
	SELECT 1
	FROM analytics_events ae
	WHERE ae.tenant_id = e.tenant_id
	  AND ae.event_name = stage0_export_status_analytics_event_name(e.status)
	  AND ae.subject_type = 'export'
	  AND ae.subject_id = e.id
  );
