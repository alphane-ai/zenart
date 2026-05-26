-- Stage 0 Rev2 server-side workflow analytics triggers.
-- Captures core workflow funnel events at the storage boundary so API handlers,
-- workers, and future import paths all emit the same tenant-scoped analytics
-- without persisting prompt bodies or other high-risk free text.

CREATE OR REPLACE FUNCTION stage0_analytics_id(prefix text, subject_id text, event_name text)
RETURNS text
LANGUAGE sql
AS $$
	SELECT prefix || '_' || md5(subject_id || ':' || event_name || ':' || clock_timestamp()::text || ':' || random()::text)
$$;

CREATE OR REPLACE FUNCTION stage0_insert_project_analytics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
	VALUES (
		stage0_analytics_id('analytics', NEW.id, 'workflow_started'),
		NEW.tenant_id,
		NEW.owner_id,
		NEW.id,
		COALESCE(NEW.workflow_id, ''),
		'workflow_started',
		'project',
		NEW.id,
		jsonb_build_object('status', NEW.status),
		NEW.created_at
	);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_stage0_analytics_insert ON projects;
CREATE TRIGGER projects_stage0_analytics_insert
AFTER INSERT ON projects
FOR EACH ROW EXECUTE FUNCTION stage0_insert_project_analytics();

CREATE OR REPLACE FUNCTION stage0_insert_candidate_set_analytics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	set_index integer;
	created_by text;
BEGIN
	SELECT COUNT(*)
	INTO set_index
	FROM candidate_sets
	WHERE tenant_id = NEW.tenant_id
	  AND project_id = NEW.project_id
	  AND created_at <= NEW.created_at;

	SELECT owner_id
	INTO created_by
	FROM projects
	WHERE tenant_id = NEW.tenant_id
	  AND id = NEW.project_id;

	INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
	VALUES (
		stage0_analytics_id('analytics', NEW.id, 'candidate_set_created'),
		NEW.tenant_id,
		created_by,
		NEW.project_id,
		COALESCE(NEW.workflow_id, ''),
		'candidate_set_created',
		'candidate_set',
		NEW.id,
		jsonb_build_object(
			'task_id', COALESCE(NEW.task_id, ''),
			'status', NEW.status,
			'candidate_set_index', set_index,
			'is_iteration', set_index > 1
		),
		NEW.created_at
	);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candidate_sets_stage0_analytics_insert ON candidate_sets;
CREATE TRIGGER candidate_sets_stage0_analytics_insert
AFTER INSERT ON candidate_sets
FOR EACH ROW EXECUTE FUNCTION stage0_insert_candidate_set_analytics();

CREATE OR REPLACE FUNCTION stage0_capture_four_candidates_ready(input_tenant_id text, input_candidate_set_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	candidate_count integer;
	set_row candidate_sets%ROWTYPE;
	created_by text;
BEGIN
	SELECT *
	INTO set_row
	FROM candidate_sets
	WHERE tenant_id = input_tenant_id
	  AND id = input_candidate_set_id;

	IF NOT FOUND OR set_row.status NOT IN ('ready', 'succeeded', 'complete', 'completed') THEN
		RETURN;
	END IF;

	SELECT COUNT(*)
	INTO candidate_count
	FROM candidate_assets
	WHERE tenant_id = input_tenant_id
	  AND candidate_set_id = input_candidate_set_id
	  AND status IN ('candidate', 'ready', 'selected');

	IF candidate_count < 4 THEN
		RETURN;
	END IF;

	IF EXISTS (
		SELECT 1
		FROM analytics_events
		WHERE tenant_id = input_tenant_id
		  AND event_name = 'four_candidates_ready'
		  AND subject_type = 'candidate_set'
		  AND subject_id = input_candidate_set_id
	) THEN
		RETURN;
	END IF;

	SELECT owner_id
	INTO created_by
	FROM projects
	WHERE tenant_id = set_row.tenant_id
	  AND id = set_row.project_id;

	INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
	VALUES (
		stage0_analytics_id('analytics', input_candidate_set_id, 'four_candidates_ready'),
		set_row.tenant_id,
		created_by,
		set_row.project_id,
		COALESCE(set_row.workflow_id, ''),
		'four_candidates_ready',
		'candidate_set',
		set_row.id,
		jsonb_build_object(
			'task_id', COALESCE(set_row.task_id, ''),
			'candidate_count', candidate_count,
			'status', set_row.status
		),
		now()
	);
END;
$$;

CREATE OR REPLACE FUNCTION stage0_candidate_sets_ready_analytics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM stage0_capture_four_candidates_ready(NEW.tenant_id, NEW.id);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candidate_sets_stage0_ready_analytics_insert ON candidate_sets;
CREATE TRIGGER candidate_sets_stage0_ready_analytics_insert
AFTER INSERT ON candidate_sets
FOR EACH ROW EXECUTE FUNCTION stage0_candidate_sets_ready_analytics();

DROP TRIGGER IF EXISTS candidate_sets_stage0_ready_analytics_update ON candidate_sets;
CREATE TRIGGER candidate_sets_stage0_ready_analytics_update
AFTER UPDATE OF status ON candidate_sets
FOR EACH ROW EXECUTE FUNCTION stage0_candidate_sets_ready_analytics();

CREATE OR REPLACE FUNCTION stage0_candidate_assets_analytics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM stage0_capture_four_candidates_ready(NEW.tenant_id, NEW.candidate_set_id);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candidate_assets_stage0_analytics_insert ON candidate_assets;
CREATE TRIGGER candidate_assets_stage0_analytics_insert
AFTER INSERT ON candidate_assets
FOR EACH ROW EXECUTE FUNCTION stage0_candidate_assets_analytics();

CREATE OR REPLACE FUNCTION stage0_insert_selected_direction_analytics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	workflow_id text;
	candidate_set_id text;
BEGIN
	SELECT cs.workflow_id, ca.candidate_set_id
	INTO workflow_id, candidate_set_id
	FROM candidate_assets ca
	JOIN candidate_sets cs ON cs.tenant_id = ca.tenant_id AND cs.id = ca.candidate_set_id
	WHERE ca.tenant_id = NEW.tenant_id
	  AND ca.id = NEW.candidate_asset_id;

	INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
	VALUES (
		stage0_analytics_id('analytics', NEW.id, 'direction_selected'),
		NEW.tenant_id,
		NEW.selected_by,
		NEW.project_id,
		COALESCE(workflow_id, ''),
		'direction_selected',
		'selected_direction',
		NEW.id,
		jsonb_build_object(
			'candidate_asset_id', NEW.candidate_asset_id,
			'candidate_set_id', COALESCE(candidate_set_id, '')
		),
		NEW.created_at
	);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS selected_directions_stage0_analytics_insert ON selected_directions;
CREATE TRIGGER selected_directions_stage0_analytics_insert
AFTER INSERT ON selected_directions
FOR EACH ROW EXECUTE FUNCTION stage0_insert_selected_direction_analytics();

CREATE OR REPLACE FUNCTION stage0_insert_package_item_analytics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	package_project_id text;
	package_user_id text;
	workflow_id text;
BEGIN
	SELECT p.project_id, p.created_by, pr.workflow_id
	INTO package_project_id, package_user_id, workflow_id
	FROM packages p
	LEFT JOIN projects pr ON pr.tenant_id = p.tenant_id AND pr.id = p.project_id
	WHERE p.tenant_id = NEW.tenant_id
	  AND p.id = NEW.package_id;

	INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
	VALUES (
		stage0_analytics_id('analytics', NEW.id, 'package_item_added'),
		NEW.tenant_id,
		package_user_id,
		package_project_id,
		COALESCE(workflow_id, ''),
		'package_item_added',
		'package_item',
		NEW.id,
		jsonb_build_object(
			'package_id', NEW.package_id,
			'asset_id', COALESCE(NEW.asset_id, ''),
			'canvas_frame_id', COALESCE(NEW.canvas_frame_id, ''),
			'item_type', NEW.item_type
		),
		NEW.created_at
	);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS package_items_stage0_analytics_insert ON package_items;
CREATE TRIGGER package_items_stage0_analytics_insert
AFTER INSERT ON package_items
FOR EACH ROW EXECUTE FUNCTION stage0_insert_package_item_analytics();

INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
SELECT
	stage0_analytics_id('analytics', p.id, 'workflow_started'),
	p.tenant_id,
	p.owner_id,
	p.id,
	COALESCE(p.workflow_id, ''),
	'workflow_started',
	'project',
	p.id,
	jsonb_build_object('status', p.status, 'backfilled', true),
	p.created_at
FROM projects p
WHERE NOT EXISTS (
	SELECT 1
	FROM analytics_events ae
	WHERE ae.tenant_id = p.tenant_id
	  AND ae.event_name = 'workflow_started'
	  AND ae.subject_type = 'project'
	  AND ae.subject_id = p.id
);

WITH indexed_sets AS (
	SELECT
		cs.*,
		COUNT(*) OVER (PARTITION BY cs.tenant_id, cs.project_id ORDER BY cs.created_at, cs.id) AS candidate_set_index,
		p.owner_id
	FROM candidate_sets cs
	LEFT JOIN projects p ON p.tenant_id = cs.tenant_id AND p.id = cs.project_id
)
INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
SELECT
	stage0_analytics_id('analytics', indexed_sets.id, 'candidate_set_created'),
	indexed_sets.tenant_id,
	indexed_sets.owner_id,
	indexed_sets.project_id,
	COALESCE(indexed_sets.workflow_id, ''),
	'candidate_set_created',
	'candidate_set',
	indexed_sets.id,
	jsonb_build_object(
		'task_id', COALESCE(indexed_sets.task_id, ''),
		'status', indexed_sets.status,
		'candidate_set_index', indexed_sets.candidate_set_index,
		'is_iteration', indexed_sets.candidate_set_index > 1,
		'backfilled', true
	),
	indexed_sets.created_at
FROM indexed_sets
WHERE NOT EXISTS (
	SELECT 1
	FROM analytics_events ae
	WHERE ae.tenant_id = indexed_sets.tenant_id
	  AND ae.event_name = 'candidate_set_created'
	  AND ae.subject_type = 'candidate_set'
	  AND ae.subject_id = indexed_sets.id
);

INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
SELECT
	stage0_analytics_id('analytics', cs.id, 'four_candidates_ready'),
	cs.tenant_id,
	p.owner_id,
	cs.project_id,
	COALESCE(cs.workflow_id, ''),
	'four_candidates_ready',
	'candidate_set',
	cs.id,
	jsonb_build_object(
		'task_id', COALESCE(cs.task_id, ''),
		'candidate_count', COUNT(ca.id),
		'status', cs.status,
		'backfilled', true
	),
	MAX(ca.created_at)
FROM candidate_sets cs
JOIN candidate_assets ca ON ca.tenant_id = cs.tenant_id AND ca.candidate_set_id = cs.id
LEFT JOIN projects p ON p.tenant_id = cs.tenant_id AND p.id = cs.project_id
WHERE cs.status IN ('ready', 'succeeded', 'complete', 'completed')
  AND ca.status IN ('candidate', 'ready', 'selected')
  AND NOT EXISTS (
	SELECT 1
	FROM analytics_events ae
	WHERE ae.tenant_id = cs.tenant_id
	  AND ae.event_name = 'four_candidates_ready'
	  AND ae.subject_type = 'candidate_set'
	  AND ae.subject_id = cs.id
  )
GROUP BY cs.id, cs.tenant_id, p.owner_id, cs.project_id, cs.workflow_id, cs.task_id, cs.status
HAVING COUNT(ca.id) >= 4;

INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
SELECT
	stage0_analytics_id('analytics', sd.id, 'direction_selected'),
	sd.tenant_id,
	sd.selected_by,
	sd.project_id,
	COALESCE(cs.workflow_id, ''),
	'direction_selected',
	'selected_direction',
	sd.id,
	jsonb_build_object(
		'candidate_asset_id', sd.candidate_asset_id,
		'candidate_set_id', COALESCE(ca.candidate_set_id, ''),
		'backfilled', true
	),
	sd.created_at
FROM selected_directions sd
LEFT JOIN candidate_assets ca ON ca.tenant_id = sd.tenant_id AND ca.id = sd.candidate_asset_id
LEFT JOIN candidate_sets cs ON cs.tenant_id = ca.tenant_id AND cs.id = ca.candidate_set_id
WHERE NOT EXISTS (
	SELECT 1
	FROM analytics_events ae
	WHERE ae.tenant_id = sd.tenant_id
	  AND ae.event_name = 'direction_selected'
	  AND ae.subject_type = 'selected_direction'
	  AND ae.subject_id = sd.id
);

INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
SELECT
	stage0_analytics_id('analytics', pi.id, 'package_item_added'),
	pi.tenant_id,
	p.created_by,
	p.project_id,
	COALESCE(pr.workflow_id, ''),
	'package_item_added',
	'package_item',
	pi.id,
	jsonb_build_object(
		'package_id', pi.package_id,
		'asset_id', COALESCE(pi.asset_id, ''),
		'canvas_frame_id', COALESCE(pi.canvas_frame_id, ''),
		'item_type', pi.item_type,
		'backfilled', true
	),
	pi.created_at
FROM package_items pi
LEFT JOIN packages p ON p.tenant_id = pi.tenant_id AND p.id = pi.package_id
LEFT JOIN projects pr ON pr.tenant_id = p.tenant_id AND pr.id = p.project_id
WHERE NOT EXISTS (
	SELECT 1
	FROM analytics_events ae
	WHERE ae.tenant_id = pi.tenant_id
	  AND ae.event_name = 'package_item_added'
	  AND ae.subject_type = 'package_item'
	  AND ae.subject_id = pi.id
);
