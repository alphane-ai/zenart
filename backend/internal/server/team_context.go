package server

import (
	"context"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/team"
)

type TeamService interface {
	CreateTeam(ctx context.Context, team team.Team, owner team.Member) (team.Team, error)
	InviteMember(ctx context.Context, invite team.Invite) (team.Invite, error)
	AcceptInvite(ctx context.Context, tenantID, teamID, inviteID, userID string, acceptedAt time.Time) (team.Member, error)
	RemoveMember(ctx context.Context, tenantID, teamID, memberID, removedBy string, removedAt time.Time) error
	GetSeatUsage(ctx context.Context, tenantID, teamID string) (team.SeatUsage, error)
	CheckSeatEntitlement(ctx context.Context, tenantID, teamID string, additionalSeats int) (team.EntitlementDecision, error)
}

type teamServiceKey struct{}

func ContextWithTeamService(ctx context.Context, service TeamService) context.Context {
	return context.WithValue(ctx, teamServiceKey{}, service)
}

func teamServiceFromContext(ctx context.Context) (TeamService, bool) {
	service, ok := ctx.Value(teamServiceKey{}).(TeamService)
	return service, ok
}
