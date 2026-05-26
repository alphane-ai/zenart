-- Stage 0 Rev2 tenant isolation guard rails.
-- Additive, forward-only constraints that make cross-tenant references fail at
-- the database boundary. Constraints are NOT VALID so existing local/dev data
-- does not block deploys, but all new writes and updates are enforced.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_id_unique ON users(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_buckets_tenant_id_unique ON quota_buckets(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_tenant_id_unique ON agent_tasks(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_traces_tenant_id_unique ON agent_traces(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_tenant_id_unique ON projects(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_tenant_id_unique ON workspaces(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_versions_tenant_id_unique ON canvas_versions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_frames_tenant_id_unique ON canvas_frames(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_nodes_tenant_id_unique ON canvas_nodes(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_tenant_id_unique ON chat_sessions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_sets_tenant_id_unique ON candidate_sets(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_assets_tenant_id_unique ON candidate_assets(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_uploads_tenant_id_unique ON uploads(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_object_metadata_tenant_id_unique ON object_metadata(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_tenant_id_unique ON assets(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_tenant_id_unique ON packages(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exports_tenant_id_unique ON exports(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_tenant_id_unique ON share_links(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_events_tenant_id_unique ON feedback_events(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_tenant_id_unique ON support_tickets(tenant_id, id);

CREATE OR REPLACE FUNCTION add_tenant_fk_if_missing(
	constraint_name text,
	table_name text,
	child_columns text,
	parent_table text,
	parent_columns text
) RETURNS void AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = constraint_name
		  AND conrelid = table_name::regclass
	) THEN
		EXECUTE format(
			'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I(%s) NOT VALID',
			table_name,
			constraint_name,
			child_columns,
			parent_table,
			parent_columns
		);
	END IF;
END;
$$ LANGUAGE plpgsql;

SELECT add_tenant_fk_if_missing('fk_sessions_tenant_user', 'sessions', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_quota_transactions_tenant_bucket', 'quota_transactions', 'tenant_id, bucket_id', 'quota_buckets', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_subscriptions_tenant_user', 'subscriptions', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_agent_traces_tenant_task', 'agent_traces', 'tenant_id, task_id', 'agent_tasks', 'tenant_id, id');

SELECT add_tenant_fk_if_missing('fk_projects_tenant_owner', 'projects', 'tenant_id, owner_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_workspaces_tenant_project', 'workspaces', 'tenant_id, project_id', 'projects', 'tenant_id, id');

SELECT add_tenant_fk_if_missing('fk_canvas_versions_tenant_workspace', 'canvas_versions', 'tenant_id, workspace_id', 'workspaces', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_versions_tenant_created_by', 'canvas_versions', 'tenant_id, created_by', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_frames_tenant_workspace', 'canvas_frames', 'tenant_id, workspace_id', 'workspaces', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_frames_tenant_version', 'canvas_frames', 'tenant_id, version_id', 'canvas_versions', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_nodes_tenant_workspace', 'canvas_nodes', 'tenant_id, workspace_id', 'workspaces', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_nodes_tenant_frame', 'canvas_nodes', 'tenant_id, frame_id', 'canvas_frames', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_nodes_tenant_version', 'canvas_nodes', 'tenant_id, version_id', 'canvas_versions', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_edges_tenant_workspace', 'canvas_edges', 'tenant_id, workspace_id', 'workspaces', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_edges_tenant_version', 'canvas_edges', 'tenant_id, version_id', 'canvas_versions', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_edges_tenant_from_node', 'canvas_edges', 'tenant_id, from_node_id', 'canvas_nodes', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_canvas_edges_tenant_to_node', 'canvas_edges', 'tenant_id, to_node_id', 'canvas_nodes', 'tenant_id, id');

SELECT add_tenant_fk_if_missing('fk_chat_sessions_tenant_project', 'chat_sessions', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_chat_sessions_tenant_user', 'chat_sessions', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_chat_messages_tenant_session', 'chat_messages', 'tenant_id, chat_session_id', 'chat_sessions', 'tenant_id, id');

SELECT add_tenant_fk_if_missing('fk_candidate_sets_tenant_project', 'candidate_sets', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_candidate_sets_tenant_task', 'candidate_sets', 'tenant_id, task_id', 'agent_tasks', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_candidate_assets_tenant_set', 'candidate_assets', 'tenant_id, candidate_set_id', 'candidate_sets', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_candidate_assets_tenant_project', 'candidate_assets', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_candidate_assets_tenant_trace', 'candidate_assets', 'tenant_id, trace_id', 'agent_traces', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_selected_directions_tenant_project', 'selected_directions', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_selected_directions_tenant_asset', 'selected_directions', 'tenant_id, candidate_asset_id', 'candidate_assets', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_selected_directions_tenant_user', 'selected_directions', 'tenant_id, selected_by', 'users', 'tenant_id, id');

SELECT add_tenant_fk_if_missing('fk_uploads_tenant_project', 'uploads', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_uploads_tenant_user', 'uploads', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_object_metadata_tenant_upload', 'object_metadata', 'tenant_id, upload_id', 'uploads', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_object_metadata_tenant_project', 'object_metadata', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_object_metadata_tenant_owner', 'object_metadata', 'tenant_id, owner_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_object_metadata_tenant_derived_from', 'object_metadata', 'tenant_id, derived_from_object_id', 'object_metadata', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_assets_tenant_project', 'assets', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_assets_tenant_object', 'assets', 'tenant_id, object_metadata_id', 'object_metadata', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_assets_tenant_candidate_asset', 'assets', 'tenant_id, candidate_asset_id', 'candidate_assets', 'tenant_id, id');

SELECT add_tenant_fk_if_missing('fk_packages_tenant_project', 'packages', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_packages_tenant_created_by', 'packages', 'tenant_id, created_by', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_package_items_tenant_package', 'package_items', 'tenant_id, package_id', 'packages', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_package_items_tenant_asset', 'package_items', 'tenant_id, asset_id', 'assets', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_package_items_tenant_canvas_frame', 'package_items', 'tenant_id, canvas_frame_id', 'canvas_frames', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_exports_tenant_package', 'exports', 'tenant_id, package_id', 'packages', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_exports_tenant_task', 'exports', 'tenant_id, task_id', 'agent_tasks', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_exports_tenant_object', 'exports', 'tenant_id, object_metadata_id', 'object_metadata', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_exports_tenant_project', 'exports', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_share_links_tenant_project', 'share_links', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_share_links_tenant_export', 'share_links', 'tenant_id, export_id', 'exports', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_share_links_tenant_created_by', 'share_links', 'tenant_id, created_by', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_share_link_access_logs_tenant_link', 'share_link_access_logs', 'tenant_id, share_link_id', 'share_links', 'tenant_id, id');

SELECT add_tenant_fk_if_missing('fk_provider_usage_logs_tenant_user', 'provider_usage_logs', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_provider_usage_logs_tenant_project', 'provider_usage_logs', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_provider_usage_logs_tenant_task', 'provider_usage_logs', 'tenant_id, task_id', 'agent_tasks', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_feedback_events_tenant_user', 'feedback_events', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_feedback_events_tenant_project', 'feedback_events', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_feedback_labels_tenant_event', 'feedback_labels', 'tenant_id, feedback_event_id', 'feedback_events', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_feedback_labels_tenant_applied_by', 'feedback_labels', 'tenant_id, applied_by', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_qa_results_tenant_project', 'qa_results', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_support_tickets_tenant_user', 'support_tickets', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_support_tickets_tenant_project', 'support_tickets', 'tenant_id, project_id', 'projects', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_support_tickets_tenant_export', 'support_tickets', 'tenant_id, linked_export_id', 'exports', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_abuse_events_tenant_user', 'abuse_events', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_user_subscriptions_tenant_user', 'user_subscriptions', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_analytics_events_tenant_user', 'analytics_events', 'tenant_id, user_id', 'users', 'tenant_id, id');
SELECT add_tenant_fk_if_missing('fk_analytics_events_tenant_project', 'analytics_events', 'tenant_id, project_id', 'projects', 'tenant_id, id');

DROP FUNCTION add_tenant_fk_if_missing(text, text, text, text, text);
