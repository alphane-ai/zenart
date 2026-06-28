#!/usr/bin/env python3
"""Validate Stage 1 team/seat billing backend contract anchors."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEAM_CODE = ROOT / "backend" / "internal" / "team" / "team.go"
TEAM_TESTS = ROOT / "backend" / "internal" / "team" / "team_test.go"
BILLING_CODE = ROOT / "backend" / "internal" / "billing" / "billing.go"
BILLING_STRIPE_CODE = ROOT / "backend" / "internal" / "billing" / "stripe_checkout.go"
BILLING_TESTS = ROOT / "backend" / "internal" / "billing" / "billing_test.go"
BILLING_STRIPE_TESTS = ROOT / "backend" / "internal" / "billing" / "stripe_checkout_test.go"
MIGRATION = ROOT / "backend" / "migrations" / "0014_stage1_team_seat_billing.sql"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
SERVER_CODE = ROOT / "backend" / "internal" / "server" / "server.go"
SERVER_CONTEXT = ROOT / "backend" / "internal" / "server" / "team_context.go"
SERVER_BILLING_CONTEXT = ROOT / "backend" / "internal" / "server" / "billing_context.go"
SERVER_TESTS = ROOT / "backend" / "internal" / "server" / "server_test.go"
APP_RUNTIME = ROOT / "backend" / "internal" / "app" / "runtime.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
WEB_GENERATED = ROOT / "web" / "lib" / "generated" / "zenart-api.ts"
ADMIN_GENERATED = ROOT / "admin" / "lib" / "generated" / "zenart-api.ts"
WEB_APP = ROOT / "web" / "components" / "workspace-app.tsx"
WEB_APP_TESTS = ROOT / "web" / "components" / "workspace-app.smoke.test.tsx"
WEB_CSS = ROOT / "web" / "app" / "globals.css"
WEB_CSRF_EVIDENCE = ROOT / "web" / "validation" / "generated-api-csrf-contract.json"
ADMIN_QUOTA_PAGE = ROOT / "admin" / "app" / "quota" / "page.tsx"
ADMIN_QUOTA_ACTIONS = ROOT / "admin" / "app" / "quota" / "actions.ts"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
WEB_BILLING_CLIENT = ROOT / "web" / "lib" / "billing-client.ts"
WEB_API_CLIENT = ROOT / "web" / "lib" / "api-client.ts"
WEB_CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"


class TeamSeatContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise TeamSeatContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def validate_migration() -> None:
    text = require_text(
        MIGRATION,
        (
            "CREATE TABLE IF NOT EXISTS teams",
            "CREATE TABLE IF NOT EXISTS team_members",
            "CREATE TABLE IF NOT EXISTS team_invites",
            "seat_limit integer NOT NULL CHECK (seat_limit > 0)",
            "role IN ('owner', 'admin', 'member')",
            "status IN ('active', 'invited', 'removed')",
            "role IN ('admin', 'member')",
            "status IN ('pending', 'accepted', 'revoked', 'expired')",
            "UNIQUE (tenant_id, team_id, idempotency_key)",
            "idx_team_members_active_user",
            "idx_team_members_active_email",
            "idx_team_invites_team_status",
            "CREATE TABLE IF NOT EXISTS team_billing_links",
            "CREATE TABLE IF NOT EXISTS team_seat_billing_syncs",
            "provider_subscription_item_id",
            "proration_behavior IN ('create_prorations', 'none', 'always_invoice')",
            "UNIQUE (tenant_id, team_id, operation, idempotency_key)",
            "idx_team_billing_links_active",
            "idx_team_billing_links_one_active",
            "idx_team_seat_billing_syncs_team_created",
            "billable seats",
        ),
    )
    require("REFERENCES subscription_plans(id)" in text, "teams must link plan_id to subscription_plans")
    require("FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id)" in text, "members/invites must be tenant-scoped to teams")


def validate_code() -> None:
    text = require_text(
        TEAM_CODE,
        (
            "func (r Repository) CreateTeam",
            "func (r Repository) InviteMember",
            "func (r Repository) AcceptInvite",
            "func (r Repository) RemoveMember",
            "func (r Repository) GetSeatUsage",
            "func (r Repository) CheckSeatEntitlement",
            "func AuditEvent",
            "ErrSeatLimitExceeded",
            "ErrInviteNotFound",
            "ErrMemberRemovalDenied",
            "security.RedactMap",
            "role <> 'owner'",
            "BillableSeats",
            "AvailableSeats",
            "ensureAcceptInviteSeatAvailable",
            "invitedMatches",
            "lower(tm.email)",
        ),
    )
    require("invite.Role == RoleOwner" in text, "InviteMember must reject owner invites")
    require('"seat_limit_exceeded"' in text, "CheckSeatEntitlement must return stable seat limit reason")
    require('"team_member:" + teamID + ":" + email' in text, "AcceptInvite must update reserved invited seat by email")


def validate_tests() -> None:
    require_text(
        TEAM_TESTS,
        (
            "TestCreateTeamPersistsTeamAndOwner",
            "TestInviteMemberReservesSeatAndWritesInviteMember",
            "TestInviteMemberRejectsOwnerRole",
            "TestInviteMemberRejectsSeatLimitExceeded",
            "TestAcceptInviteConvertsReservedInviteSeatToActiveMember",
            "TestAcceptInviteRejectsWhenNoReservedInviteSeatAndLimitExceeded",
            "TestAcceptInviteMapsMissingInvite",
            "TestRemoveMemberDeniesOwnerOrMissingMember",
            "TestGetSeatUsageAndCheckEntitlement",
            "TestAuditEventRedactsSecretsAndTargetsTeamResource",
            "ErrSeatLimitExceeded",
            "ErrInviteNotFound",
            "ErrMemberRemovalDenied",
            "security.Redacted",
        ),
    )


def validate_api_contract() -> None:
    require_text(
        SERVER_CONTEXT,
        (
            "type TeamService interface",
            "ContextWithTeamService",
            "teamServiceFromContext",
            "CreateTeam(ctx context.Context, team team.Team, owner team.Member)",
            "InviteMember(ctx context.Context, invite team.Invite)",
            "AcceptInvite(ctx context.Context, tenantID, teamID, inviteID, userID string",
            "RemoveMember(ctx context.Context, tenantID, teamID, memberID, removedBy string",
            "GetSeatUsage(ctx context.Context, tenantID, teamID string)",
            "CheckSeatEntitlement(ctx context.Context, tenantID, teamID string, additionalSeats int)",
        ),
    )
    require_text(
        SERVER_BILLING_CONTEXT,
        (
            "ContextWithTeamSeatBillingSyncer",
            "ContextWithTeamSeatBillingManager",
            "teamSeatBillingSyncerFromContext",
            "teamSeatBillingManagerFromContext",
            "billing.TeamSeatBillingSyncer",
            "billing.TeamSeatBillingManager",
        ),
    )
    require_text(
        APP_RUNTIME,
        (
            "team.NewRepository(db)",
            "server.ContextWithTeamService",
            "billing.NewTeamSeatBillingRepository(db, billingProvider)",
            "server.ContextWithTeamSeatBillingManager",
        ),
    )
    require_text(
        SERVER_CODE,
        (
            "/api/v1/teams/{team_id}/seat-usage",
            "/api/v1/teams/{team_id}/seat-entitlement",
            "/api/v1/teams/{team_id}/invites/{invite_id}/accept",
            "/api/admin/v1/teams",
            "/api/admin/v1/teams/{team_id}/invites",
            "/api/admin/v1/teams/{team_id}/members/{member_id}/remove",
            "/api/admin/v1/team-seat-ops/{team_id}/seat-usage",
            "/api/admin/v1/team-seat-ops/{team_id}/billing-link",
            "/api/admin/v1/team-seat-ops/{team_id}/seat-syncs",
            "func (s *Server) getTeamSeatUsage",
            "func (s *Server) checkTeamSeatEntitlement",
            "func (s *Server) acceptTeamInvite",
            "func (s *Server) createAdminTeam",
            "func (s *Server) createAdminTeamInvite",
            "func (s *Server) removeAdminTeamMember",
            "func (s *Server) getAdminTeamBillingLink",
            "func (s *Server) upsertAdminTeamBillingLink",
            "func (s *Server) listAdminTeamSeatBillingSyncs",
            "team.AuditEvent",
            "team_audit_not_connected",
            "team_service_not_connected",
            "team_seat_limit_exceeded",
            "team.billing_link.requested",
            "SyncSeatBilling: true",
            "syncTeamSeatBillingAfterMutation",
            "team_seat_billing_sync_failed",
            "team.invite.accept",
        ),
    )
    require_text(
        SERVER_TESTS,
        (
            "TestTeamSeatUsageUsesPrincipalTenant",
            "TestTeamSeatEntitlementParsesAdditionalSeats",
            "TestAcceptTeamInviteCallsServiceWithPrincipalTenant",
            "TestAcceptTeamInviteRequiresIdempotencyBeforeMutation",
            "TestAdminTeamCreateRecordsAuditAndCallsService",
            "TestAdminTeamInviteRecordsAuditAndNormalizesPayload",
            "TestAdminTeamInviteSyncsStripeSeatQuantityAfterMutation",
            "TestAdminTeamInviteSeatSyncFailureReturnsBadGatewayAndRecordsFailureAudit",
            "TestAcceptTeamInviteSyncsSeatBillingWhenSyncerConnected",
            "TestAdminTeamRemoveMapsDeniedAndRecordsFailureAudit",
            "TestAdminTeamOpsRequireAuditBeforeMutation",
            "TestAdminTeamOpsRejectInsufficientRoleBeforeMutation",
            "TestAdminTeamSeatUsageUsesAdminTenant",
            "TestAdminTeamBillingLinkReadUsesAdminTenant",
            "TestAdminTeamBillingLinkUpsertRequiresAuditBeforeMutation",
            "TestAdminTeamBillingLinkUpsertRecordsAuditAndRedactsSecrets",
            "TestAdminTeamBillingLinkUpsertFailureRecordsFailureAudit",
            "TestAdminTeamSeatBillingSyncsListsHistory",
            "fakeTeamService",
            "fakeTeamSeatBillingSyncer",
            "fakeTeamSeatBillingManager",
        ),
    )


def validate_seat_billing_sync() -> None:
    require_text(
        BILLING_CODE,
        (
            "type TeamSeatSyncInput struct",
            "type TeamSeatProviderRequest struct",
            "type TeamSeatSyncResult struct",
            "type TeamBillingLink struct",
            "type TeamBillingLinkInput struct",
            "type TeamSeatSyncPage struct",
            "type TeamSeatBillingSyncer interface",
            "type TeamSeatBillingManager interface",
            "type TeamSeatBillingProvider interface",
            "func NewTeamSeatBillingRepository",
            "func (r TeamSeatBillingRepository) SyncTeamSeatQuantity",
            "func (r TeamSeatBillingRepository) GetTeamBillingLink",
            "func (r TeamSeatBillingRepository) UpsertTeamBillingLink",
            "func (r TeamSeatBillingRepository) ListTeamSeatBillingSyncs",
            "FROM team_billing_links",
            "INSERT INTO team_seat_billing_syncs",
            "ErrTeamSeatBillingValidation",
            "ErrTeamSeatBillingProviderMissing",
            "teamSeatSyncID",
            "security.RedactString(err.Error())",
        ),
    )
    require_text(
        BILLING_STRIPE_CODE,
        (
            "func (a StripeAdapter) SyncTeamSeatQuantity",
            '"/v1/subscription_items/"+url.PathEscape(itemID)',
            'form.Set("quantity"',
            'form.Set("proration_behavior"',
            "teamSeatStripeIdempotencyKey",
            "stripe team seat response livemode=true while STRIPE_MODE=test",
        ),
    )
    require_text(
        BILLING_TESTS,
        (
            "TestTeamSeatBillingRepositorySkipsWhenTeamHasNoBillingLink",
            "TestTeamSeatBillingRepositorySyncsProviderAndPersistsLedger",
            "TestTeamSeatBillingRepositoryUpsertsBillingLinkAndRedactsMetadata",
            "TestTeamSeatBillingRepositoryListsSeatSyncs",
            "fakeTeamSeatBillingProvider",
            "team_billing_link_missing",
            "INSERT INTO team_seat_billing_syncs",
        ),
    )
    require_text(
        BILLING_STRIPE_TESTS,
        (
            "TestStripeSyncTeamSeatQuantityUpdatesSubscriptionItem",
            "/v1/subscription_items/si_test_team_seats",
            "team-seat:tenant_1:team_1:team.invite:team-invite-1",
            "proration_behavior",
        ),
    )


def validate_openapi_and_clients() -> None:
    require_text(
        OPENAPI,
        (
            "operationId: getTeamSeatUsage",
            "operationId: checkTeamSeatEntitlement",
            "operationId: acceptTeamInvite",
            "operationId: createAdminTeam",
            "operationId: createAdminTeamInvite",
            "operationId: removeAdminTeamMember",
            "operationId: getAdminTeamSeatUsage",
            "operationId: getAdminTeamBillingLink",
            "operationId: upsertAdminTeamBillingLink",
            "operationId: listAdminTeamSeatBillingSyncs",
            "TeamSeatUsage:",
            "TeamSeatEntitlement:",
            "TeamBillingLink:",
            "TeamBillingLinkUpsert:",
            "TeamSeatSyncPage:",
            "AdminTeamCreate:",
            "AdminTeamInviteCreate:",
            "AdminTeamMemberRemove:",
            "AdminTeamMemberRemoveResult:",
            "Pending invites reserve billable seats.",
            "x-idempotency-required: true",
        ),
    )
    for path in (WEB_GENERATED, ADMIN_GENERATED):
        require_text(
            path,
            (
                "getTeamSeatUsage",
                "checkTeamSeatEntitlement",
                "acceptTeamInvite",
                'path: "/teams/{team_id}/seat-usage"',
                'path: "/teams/{team_id}/invites/{invite_id}/accept"',
            ),
        )
    require_text(
        ADMIN_GENERATED,
        (
            "createAdminTeam",
            "createAdminTeamInvite",
            "removeAdminTeamMember",
            "getAdminTeamSeatUsage",
            "getAdminTeamBillingLink",
            "upsertAdminTeamBillingLink",
            "listAdminTeamSeatBillingSyncs",
            'path: "/team-seat-ops/{team_id}/seat-usage"',
            'path: "/team-seat-ops/{team_id}/billing-link"',
            'path: "/team-seat-ops/{team_id}/seat-syncs"',
        ),
    )


def validate_admin_ui() -> None:
    require_text(
        ADMIN_QUOTA_ACTIONS,
        (
            "createAdminTeamAction",
            "createAdminTeamInviteAction",
            "removeAdminTeamMemberAction",
            "/api/admin/v1/teams",
            "/invites",
            "/members/",
            "/remove",
            "upsertTeamBillingLinkAction",
            "/api/admin/v1/team-seat-ops/",
            "/billing-link",
            "Idempotency-Key",
            "X-Zenari-CSRF",
            "provider_subscription_item_id",
            "proration_behavior",
        ),
    )
    require_text(
        ADMIN_QUOTA_PAGE,
        (
            "Team Seat Operations",
            "Create Team",
            "Invite Seat",
            "Remove Member",
            "TeamSeatUsage",
            "createAdminTeamAction",
            "createAdminTeamInviteAction",
            "removeAdminTeamMemberAction",
            'data-admin-endpoint="team-seat-ops"',
            "Team Billing Link",
            "Stripe subscription item",
            "upsertTeamBillingLinkAction",
            "seat-syncs",
            "provider_subscription_item_id",
            "proration_behavior",
        ),
    )
    require_text(
        ADMIN_API,
        (
            "getTeamSeatOpsPanel",
            "/api/admin/v1/team-seat-ops/",
            "/seat-usage",
            "teamSeatUsageFixture",
            "teamInviteFixture",
            "teamMemberRemoveFixture",
        ),
    )
    require_text(
        ADMIN_TYPES,
        (
            "export type Team =",
            "export type TeamInvite =",
            "export type AdminTeamMemberRemoveResult =",
            "export type TeamSeatUsage =",
            "export type TeamBillingLink =",
            "export type TeamSeatBillingSync =",
        ),
    )


def validate_web_guard_evidence() -> None:
    require_text(
        WEB_CONTRACTS,
        (
            "export interface TeamSeatUsage",
            "export interface TeamSeatEntitlement",
            "export interface TeamSeatBillingProjection",
            "export interface TeamInviteState",
            "export interface TeamSeatState",
            "prorationBehavior",
            "invoiceImpact",
            "nextBillableSeats",
            "safeProjection: true",
            "teamSeats: TeamSeatState",
            "refreshTeamSeats(): Promise<WorkspaceState>",
        ),
    )
    require_text(
        WEB_BILLING_CLIENT,
        (
            "getTeamSeatUsage(teamId: string)",
            "checkTeamSeatEntitlement(teamId: string",
            "acceptTeamInvite(teamId: string, inviteId: string",
            '"getTeamSeatUsage"',
            '"checkTeamSeatEntitlement"',
            '"acceptTeamInvite"',
            "team_id: teamId",
            "invite_id: inviteId",
        ),
    )
    require_text(
        WEB_API_CLIENT,
        (
            "refreshTeamSeatProjection",
            "async refreshTeamSeats()",
            "async acceptTeamInvite()",
            "billingClient.getTeamSeatUsage(teamID)",
            "billingClient.checkTeamSeatEntitlement(teamID, 1)",
            "nextBillableSeats: usage.billable_seats",
            ' = "team.seat.refresh"',
            "auditEvent,",
            'auditEvent: "team.invite.accept"',
            "safeProjection: true",
            "this.billingClient.acceptTeamInvite(",
            "team-invite-accept-${state.session.id}-${invite.inviteId}",
        ),
    )
    require_text(
        WEB_APP,
        (
            "Team Seats",
            'data-team-seat-ui="stage1.team-seat-product-ui"',
            'data-team-seat-usage-contract="getTeamSeatUsage:GET:/teams/{team_id}/seat-usage:include:not-required:false"',
            'data-team-seat-entitlement-contract="checkTeamSeatEntitlement:GET:/teams/{team_id}/seat-entitlement:include:not-required:false"',
            'data-team-seat-accept-contract="acceptTeamInvite:POST:/teams/{team_id}/invites/{invite_id}/accept:include:X-Zenari-CSRF:true"',
            'data-team-seat-billing-projection="stage1.team-seat-billing-safe-projection"',
            "data-team-seat-billing-provider",
            "data-team-seat-billing-proration",
            "data-team-seat-billing-invoice-impact",
            "data-team-seat-billing-sync-status",
            "data-team-seat-billing-safe-projection",
            "Next billable seats",
            "Stripe proration",
            "Seat billing sync",
            '"Refresh Team Seats": ["getTeamSeatUsage", "checkTeamSeatEntitlement"]',
            'unsafeActionGuardAttributes("Refresh Team Seats", state)',
            "zenariClient.refreshTeamSeats()",
            '"Accept Invite": ["acceptTeamInvite"]',
            'unsafeActionGuardAttributes("Accept Invite", state)',
            "zenariClient.acceptTeamInvite()",
            "Users size={18}",
        ),
    )
    require_text(
        WEB_APP_TESTS,
        (
            "stage1.team-seat-billing-safe-projection",
            "data-team-seat-billing-proration",
            "data-team-seat-billing-safe-projection",
            "Next billable seats",
            "prorated on next invoice",
        ),
    )
    require_text(
        WEB_CSS,
        (
            ".team-seat-billing-panel",
            ".team-seat-billing-note",
        ),
    )
    require_text(
        WEB_CSRF_EVIDENCE,
        (
            '"acceptTeamInvite"',
            '"getTeamSeatUsage"',
            '"checkTeamSeatEntitlement"',
            '"acceptTeamInvite:POST:include:same-site-origin-check:csrf-probe-acceptTeamInvite"',
            '"/teams/{team_id}/seat-usage"',
            '"/teams/{team_id}/invites/{invite_id}/accept"',
        ),
    )


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "team/seat billing backend/API contract",
            "0014_stage1_team_seat_billing.sql",
            "validate_stage1_team_seat_billing_contract.py",
            "backend/API contract",
            "generated web/admin clients",
            "Stripe seat proration/sync",
            "team_billing_links",
            "team_seat_billing_syncs",
            "admin billing-link management API",
            "admin quota-page controls",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_team_seat_billing_contract.py",
            "python3 scripts/validate_stage1_team_seat_billing_contract.py",
        ),
    )


def validate() -> None:
    validate_migration()
    validate_code()
    validate_tests()
    validate_api_contract()
    validate_seat_billing_sync()
    validate_openapi_and_clients()
    validate_admin_ui()
    validate_web_guard_evidence()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except TeamSeatContractError as exc:
        print(f"stage1 team/seat billing contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 team/seat billing contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
