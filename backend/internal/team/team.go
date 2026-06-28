package team

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/audit"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
)

type Role string

const (
	RoleOwner  Role = "owner"
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
)

type MemberStatus string

const (
	MemberActive  MemberStatus = "active"
	MemberInvited MemberStatus = "invited"
	MemberRemoved MemberStatus = "removed"
)

type Team struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	Name      string    `json:"name"`
	PlanID    string    `json:"plan_id"`
	SeatLimit int       `json:"seat_limit"`
	CreatedAt time.Time `json:"created_at"`
}

type Member struct {
	ID        string       `json:"id"`
	TeamID    string       `json:"team_id"`
	TenantID  string       `json:"tenant_id"`
	UserID    string       `json:"user_id"`
	Email     string       `json:"email"`
	Role      Role         `json:"role"`
	Status    MemberStatus `json:"status"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
}

type Invite struct {
	ID             string    `json:"id"`
	TeamID         string    `json:"team_id"`
	TenantID       string    `json:"tenant_id"`
	Email          string    `json:"email"`
	Role           Role      `json:"role"`
	IdempotencyKey string    `json:"idempotency_key"`
	InvitedBy      string    `json:"invited_by"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
}

type SeatUsage struct {
	TeamID         string `json:"team_id"`
	TenantID       string `json:"tenant_id"`
	PlanID         string `json:"plan_id"`
	SeatLimit      int    `json:"seat_limit"`
	ActiveSeats    int    `json:"active_seats"`
	InvitedSeats   int    `json:"invited_seats"`
	BillableSeats  int    `json:"billable_seats"`
	AvailableSeats int    `json:"available_seats"`
}

type EntitlementDecision struct {
	Allowed bool      `json:"allowed"`
	Reason  string    `json:"reason"`
	Usage   SeatUsage `json:"usage"`
}

type Repository struct {
	db store.DBTX
}

func NewRepository(db store.DBTX) Repository {
	return Repository{db: db}
}

func (r Repository) CreateTeam(ctx context.Context, team Team, owner Member) (Team, error) {
	if err := validateTeam(team); err != nil {
		return Team{}, err
	}
	if owner.UserID == "" || owner.Email == "" {
		return Team{}, errors.New("owner user_id and email are required")
	}
	owner.ID = firstNonEmpty(owner.ID, "team_member:"+team.ID+":"+owner.UserID)
	owner.TeamID = team.ID
	owner.TenantID = team.TenantID
	owner.Role = RoleOwner
	owner.Status = MemberActive
	now := firstTime(team.CreatedAt, time.Now().UTC())
	team.CreatedAt = now
	owner.CreatedAt = firstTime(owner.CreatedAt, now)
	owner.UpdatedAt = firstTime(owner.UpdatedAt, now)

	tx, err := begin(ctx, r.db)
	if err != nil {
		return Team{}, err
	}
	defer rollback(ctx, tx)

	if _, err := tx.Exec(ctx, `
INSERT INTO teams(id, tenant_id, name, plan_id, seat_limit, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, $6, $6)
ON CONFLICT (tenant_id, id) DO UPDATE
SET name = EXCLUDED.name,
    plan_id = EXCLUDED.plan_id,
    seat_limit = EXCLUDED.seat_limit,
    updated_at = EXCLUDED.updated_at`,
		team.ID,
		team.TenantID,
		team.Name,
		team.PlanID,
		team.SeatLimit,
		team.CreatedAt.UTC(),
	); err != nil {
		return Team{}, err
	}
	if _, err := upsertMember(ctx, tx, owner); err != nil {
		return Team{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Team{}, err
	}
	return team, nil
}

func (r Repository) InviteMember(ctx context.Context, invite Invite) (Invite, error) {
	if err := validateInvite(invite); err != nil {
		return Invite{}, err
	}
	invite.Email = normalizeEmail(invite.Email)
	now := firstTime(invite.CreatedAt, time.Now().UTC())
	invite.CreatedAt = now
	if invite.ExpiresAt.IsZero() {
		invite.ExpiresAt = now.Add(7 * 24 * time.Hour)
	}
	if invite.ID == "" {
		invite.ID = deterministicID("team_invite", invite.TenantID, invite.TeamID, invite.Email, invite.IdempotencyKey)
	}

	tx, err := begin(ctx, r.db)
	if err != nil {
		return Invite{}, err
	}
	defer rollback(ctx, tx)

	if err := ensureSeatAvailable(ctx, tx, invite.TenantID, invite.TeamID); err != nil {
		return Invite{}, err
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO team_invites(id, team_id, tenant_id, email, role, idempotency_key, invited_by, status, expires_at, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $9)
ON CONFLICT (tenant_id, team_id, idempotency_key) DO NOTHING`,
		invite.ID,
		invite.TeamID,
		invite.TenantID,
		invite.Email,
		string(invite.Role),
		invite.IdempotencyKey,
		invite.InvitedBy,
		invite.ExpiresAt.UTC(),
		invite.CreatedAt.UTC(),
	); err != nil {
		return Invite{}, err
	}
	member := Member{
		ID:        "team_member:" + invite.TeamID + ":" + invite.Email,
		TeamID:    invite.TeamID,
		TenantID:  invite.TenantID,
		Email:     invite.Email,
		Role:      invite.Role,
		Status:    MemberInvited,
		CreatedAt: invite.CreatedAt,
		UpdatedAt: invite.CreatedAt,
	}
	if _, err := upsertMember(ctx, tx, member); err != nil {
		return Invite{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Invite{}, err
	}
	return invite, nil
}

func (r Repository) AcceptInvite(ctx context.Context, tenantID, teamID, inviteID, userID string, acceptedAt time.Time) (Member, error) {
	if tenantID == "" || teamID == "" || inviteID == "" || userID == "" {
		return Member{}, errors.New("tenant_id, team_id, invite_id, and user_id are required")
	}
	now := firstTime(acceptedAt, time.Now().UTC())
	tx, err := begin(ctx, r.db)
	if err != nil {
		return Member{}, err
	}
	defer rollback(ctx, tx)

	var email, roleValue string
	if err := tx.QueryRow(ctx, `
SELECT email, role
FROM team_invites
WHERE tenant_id = $1
  AND team_id = $2
  AND id = $3
  AND status = 'pending'
  AND expires_at > $4`,
		tenantID,
		teamID,
		inviteID,
		now.UTC(),
	).Scan(&email, &roleValue); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Member{}, ErrInviteNotFound
		}
		return Member{}, err
	}
	email = normalizeEmail(email)
	member := Member{
		ID:        "team_member:" + teamID + ":" + email,
		TeamID:    teamID,
		TenantID:  tenantID,
		UserID:    userID,
		Email:     email,
		Role:      Role(roleValue),
		Status:    MemberActive,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := ensureAcceptInviteSeatAvailable(ctx, tx, tenantID, teamID, email); err != nil {
		return Member{}, err
	}
	if _, err := upsertMember(ctx, tx, member); err != nil {
		return Member{}, err
	}
	if _, err := tx.Exec(ctx, `
UPDATE team_invites
SET status = 'accepted', accepted_by = $4, updated_at = $5
WHERE tenant_id = $1 AND team_id = $2 AND id = $3`,
		tenantID,
		teamID,
		inviteID,
		userID,
		now.UTC(),
	); err != nil {
		return Member{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Member{}, err
	}
	return member, nil
}

func (r Repository) RemoveMember(ctx context.Context, tenantID, teamID, memberID, removedBy string, removedAt time.Time) error {
	if tenantID == "" || teamID == "" || memberID == "" || removedBy == "" {
		return errors.New("tenant_id, team_id, member_id, and removed_by are required")
	}
	now := firstTime(removedAt, time.Now().UTC())
	tag, err := r.db.Exec(ctx, `
UPDATE team_members
SET status = 'removed',
    removed_by = $4,
    removed_at = $5,
    updated_at = $5
WHERE tenant_id = $1
  AND team_id = $2
  AND id = $3
  AND status IN ('active', 'invited')
  AND role <> 'owner'`,
		tenantID,
		teamID,
		memberID,
		removedBy,
		now.UTC(),
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrMemberRemovalDenied
	}
	return nil
}

func (r Repository) GetSeatUsage(ctx context.Context, tenantID, teamID string) (SeatUsage, error) {
	if tenantID == "" || teamID == "" {
		return SeatUsage{}, errors.New("tenant_id and team_id are required")
	}
	var usage SeatUsage
	if err := r.db.QueryRow(ctx, `
SELECT t.id,
       t.tenant_id,
       t.plan_id,
       t.seat_limit,
       COALESCE(count(*) FILTER (WHERE tm.status = 'active'), 0)::int,
       COALESCE(count(*) FILTER (WHERE tm.status = 'invited'), 0)::int
FROM teams t
LEFT JOIN team_members tm
  ON tm.tenant_id = t.tenant_id
 AND tm.team_id = t.id
 AND tm.status IN ('active', 'invited')
WHERE t.tenant_id = $1
  AND t.id = $2
GROUP BY t.id, t.tenant_id, t.plan_id, t.seat_limit`,
		tenantID,
		teamID,
	).Scan(&usage.TeamID, &usage.TenantID, &usage.PlanID, &usage.SeatLimit, &usage.ActiveSeats, &usage.InvitedSeats); err != nil {
		return SeatUsage{}, err
	}
	usage.BillableSeats = usage.ActiveSeats + usage.InvitedSeats
	usage.AvailableSeats = usage.SeatLimit - usage.BillableSeats
	if usage.AvailableSeats < 0 {
		usage.AvailableSeats = 0
	}
	return usage, nil
}

func (r Repository) CheckSeatEntitlement(ctx context.Context, tenantID, teamID string, additionalSeats int) (EntitlementDecision, error) {
	if additionalSeats < 0 {
		return EntitlementDecision{}, errors.New("additional seats must be non-negative")
	}
	usage, err := r.GetSeatUsage(ctx, tenantID, teamID)
	if err != nil {
		return EntitlementDecision{}, err
	}
	if usage.BillableSeats+additionalSeats > usage.SeatLimit {
		return EntitlementDecision{Allowed: false, Reason: "seat_limit_exceeded", Usage: usage}, nil
	}
	return EntitlementDecision{Allowed: true, Reason: "ok", Usage: usage}, nil
}

func AuditEvent(tenantID, actorID, action, teamID string, metadata map[string]any, at time.Time) audit.Event {
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["team_id"] = teamID
	return audit.Event{
		ID:        deterministicID("team_audit", tenantID, actorID, action, teamID, firstTime(at, time.Now().UTC()).Format(time.RFC3339Nano)),
		TenantID:  tenantID,
		ActorID:   actorID,
		Action:    action,
		Resource:  "teams/" + teamID,
		Metadata:  security.RedactMap(metadata),
		CreatedAt: firstTime(at, time.Now().UTC()),
	}
}

var ErrSeatLimitExceeded = errors.New("team seat limit exceeded")
var ErrInviteNotFound = errors.New("team invite not found")
var ErrMemberRemovalDenied = errors.New("team member removal denied")

func validateTeam(team Team) error {
	if team.ID == "" || team.TenantID == "" || team.Name == "" || team.PlanID == "" {
		return errors.New("team id, tenant_id, name, and plan_id are required")
	}
	if team.SeatLimit <= 0 {
		return errors.New("team seat_limit must be positive")
	}
	return nil
}

func validateInvite(invite Invite) error {
	if invite.TeamID == "" || invite.TenantID == "" || invite.Email == "" || invite.IdempotencyKey == "" || invite.InvitedBy == "" {
		return errors.New("team_id, tenant_id, email, idempotency_key, and invited_by are required")
	}
	if !validRole(invite.Role) || invite.Role == RoleOwner {
		return errors.New("invite role must be admin or member")
	}
	return nil
}

func validRole(role Role) bool {
	switch role {
	case RoleOwner, RoleAdmin, RoleMember:
		return true
	default:
		return false
	}
}

func upsertMember(ctx context.Context, db store.DBTX, member Member) (int64, error) {
	tag, err := db.Exec(ctx, `
INSERT INTO team_members(id, team_id, tenant_id, user_id, email, role, status, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (tenant_id, team_id, id) DO UPDATE
SET user_id = COALESCE(NULLIF(EXCLUDED.user_id, ''), team_members.user_id),
    email = COALESCE(NULLIF(EXCLUDED.email, ''), team_members.email),
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at`,
		member.ID,
		member.TeamID,
		member.TenantID,
		member.UserID,
		normalizeEmail(member.Email),
		string(member.Role),
		string(member.Status),
		firstTime(member.CreatedAt, time.Now().UTC()).UTC(),
		firstTime(member.UpdatedAt, time.Now().UTC()).UTC(),
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func ensureSeatAvailable(ctx context.Context, db store.DBTX, tenantID, teamID string) error {
	var seatLimit, billableSeats int
	if err := db.QueryRow(ctx, `
SELECT t.seat_limit,
       COALESCE(count(*) FILTER (WHERE tm.status IN ('active', 'invited')), 0)::int
FROM teams t
LEFT JOIN team_members tm
  ON tm.tenant_id = t.tenant_id
 AND tm.team_id = t.id
WHERE t.tenant_id = $1
  AND t.id = $2
GROUP BY t.seat_limit`,
		tenantID,
		teamID,
	).Scan(&seatLimit, &billableSeats); err != nil {
		return err
	}
	if billableSeats+1 > seatLimit {
		return ErrSeatLimitExceeded
	}
	return nil
}

func ensureAcceptInviteSeatAvailable(ctx context.Context, db store.DBTX, tenantID, teamID, email string) error {
	var seatLimit, billableSeats, invitedMatches int
	if err := db.QueryRow(ctx, `
SELECT t.seat_limit,
       COALESCE(count(*) FILTER (WHERE tm.status IN ('active', 'invited')), 0)::int,
       COALESCE(count(*) FILTER (WHERE tm.status = 'invited' AND lower(tm.email) = lower($3)), 0)::int
FROM teams t
LEFT JOIN team_members tm
  ON tm.tenant_id = t.tenant_id
 AND tm.team_id = t.id
WHERE t.tenant_id = $1
  AND t.id = $2
GROUP BY t.seat_limit`,
		tenantID,
		teamID,
		normalizeEmail(email),
	).Scan(&seatLimit, &billableSeats, &invitedMatches); err != nil {
		return err
	}
	projectedSeats := billableSeats
	if invitedMatches == 0 {
		projectedSeats++
	}
	if projectedSeats > seatLimit {
		return ErrSeatLimitExceeded
	}
	return nil
}

func begin(ctx context.Context, db store.DBTX) (store.Tx, error) {
	if transactor, ok := db.(store.Transactor); ok {
		return transactor.Begin(ctx)
	}
	return noopTx{DBTX: db}, nil
}

type noopTx struct {
	store.DBTX
}

func (noopTx) Commit(context.Context) error {
	return nil
}

func (noopTx) Rollback(context.Context) error {
	return nil
}

func rollback(ctx context.Context, tx store.Tx) {
	_ = tx.Rollback(ctx)
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstTime(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value.UTC()
		}
	}
	return time.Now().UTC()
}

func deterministicID(prefix string, parts ...string) string {
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return fmt.Sprintf("%s_%x", prefix, hash[:12])
}
