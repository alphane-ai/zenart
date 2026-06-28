package team

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
)

func TestCreateTeamPersistsTeamAndOwner(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeDB{rowsAffected: []int64{1, 1}}
	repo := NewRepository(db)

	created, err := repo.CreateTeam(context.Background(), Team{
		ID:        "team_1",
		TenantID:  "tenant_1",
		Name:      "Design Team",
		PlanID:    "plan_pro",
		SeatLimit: 3,
		CreatedAt: now,
	}, Member{
		UserID: "user_owner",
		Email:  "Owner@Example.COM",
	})
	if err != nil {
		t.Fatalf("CreateTeam() error = %v", err)
	}
	if created.ID != "team_1" || created.SeatLimit != 3 || !created.CreatedAt.Equal(now) {
		t.Fatalf("created team = %#v", created)
	}
	if len(db.execSQL) != 2 {
		t.Fatalf("exec count = %d, want 2", len(db.execSQL))
	}
	if !strings.Contains(db.execSQL[0], "INSERT INTO teams") {
		t.Fatalf("team insert SQL = %s", db.execSQL[0])
	}
	if !strings.Contains(db.execSQL[1], "INSERT INTO team_members") {
		t.Fatalf("member upsert SQL = %s", db.execSQL[1])
	}
	if db.execArgs[1][3] != "user_owner" || db.execArgs[1][5] != string(RoleOwner) || db.execArgs[1][6] != string(MemberActive) {
		t.Fatalf("owner args = %#v", db.execArgs[1])
	}
	if db.commits != 1 {
		t.Fatalf("commits = %d, want 1", db.commits)
	}
}

func TestInviteMemberReservesSeatAndWritesInviteMember(t *testing.T) {
	now := time.Date(2026, 6, 22, 11, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryRows: []fakeQueryRow{{values: []any{2, 1}}},
	}
	repo := NewRepository(db)

	invite, err := repo.InviteMember(context.Background(), Invite{
		TeamID:         "team_1",
		TenantID:       "tenant_1",
		Email:          "MEMBER@Example.COM ",
		Role:           RoleMember,
		IdempotencyKey: "invite_1",
		InvitedBy:      "user_owner",
		CreatedAt:      now,
	})
	if err != nil {
		t.Fatalf("InviteMember() error = %v", err)
	}
	if invite.Email != "member@example.com" {
		t.Fatalf("invite email = %q, want normalized", invite.Email)
	}
	if invite.ID == "" || !strings.HasPrefix(invite.ID, "team_invite_") {
		t.Fatalf("invite ID = %q, want deterministic team_invite prefix", invite.ID)
	}
	if len(db.queryRowSQL) != 1 || !strings.Contains(db.queryRowSQL[0], "count(*) FILTER") {
		t.Fatalf("seat query SQL = %#v", db.queryRowSQL)
	}
	if len(db.execSQL) != 2 {
		t.Fatalf("exec count = %d, want invite insert and invited member upsert", len(db.execSQL))
	}
	if !strings.Contains(db.execSQL[0], "INSERT INTO team_invites") || db.execArgs[0][3] != "member@example.com" {
		t.Fatalf("invite insert SQL/args = %s %#v", db.execSQL[0], db.execArgs[0])
	}
	if !strings.Contains(db.execSQL[1], "INSERT INTO team_members") || db.execArgs[1][6] != string(MemberInvited) {
		t.Fatalf("invited member SQL/args = %s %#v", db.execSQL[1], db.execArgs[1])
	}
}

func TestInviteMemberRejectsOwnerRole(t *testing.T) {
	repo := NewRepository(&fakeDB{})
	_, err := repo.InviteMember(context.Background(), Invite{
		TeamID:         "team_1",
		TenantID:       "tenant_1",
		Email:          "owner@example.com",
		Role:           RoleOwner,
		IdempotencyKey: "invite_owner",
		InvitedBy:      "user_owner",
	})
	if err == nil {
		t.Fatal("InviteMember() error = nil, want owner role rejection")
	}
}

func TestInviteMemberRejectsSeatLimitExceeded(t *testing.T) {
	db := &fakeDB{queryRows: []fakeQueryRow{{values: []any{1, 1}}}}
	repo := NewRepository(db)

	_, err := repo.InviteMember(context.Background(), Invite{
		TeamID:         "team_1",
		TenantID:       "tenant_1",
		Email:          "member@example.com",
		Role:           RoleMember,
		IdempotencyKey: "invite_1",
		InvitedBy:      "user_owner",
	})
	if !errors.Is(err, ErrSeatLimitExceeded) {
		t.Fatalf("InviteMember() error = %v, want ErrSeatLimitExceeded", err)
	}
	if len(db.execSQL) != 0 {
		t.Fatalf("execs = %d, want no writes after seat denial", len(db.execSQL))
	}
}

func TestAcceptInviteConvertsReservedInviteSeatToActiveMember(t *testing.T) {
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryRows: []fakeQueryRow{
			{values: []any{"MEMBER@Example.COM", string(RoleMember)}},
			{values: []any{1, 1, 1}},
		},
	}
	repo := NewRepository(db)

	member, err := repo.AcceptInvite(context.Background(), "tenant_1", "team_1", "invite_1", "user_member", now)
	if err != nil {
		t.Fatalf("AcceptInvite() error = %v", err)
	}
	if member.ID != "team_member:team_1:member@example.com" || member.UserID != "user_member" || member.Status != MemberActive {
		t.Fatalf("accepted member = %#v", member)
	}
	if len(db.queryRowSQL) != 2 {
		t.Fatalf("query rows = %d, want invite lookup and net-seat check", len(db.queryRowSQL))
	}
	if !strings.Contains(db.queryRowSQL[1], "invitedMatches") && !strings.Contains(db.queryRowSQL[1], "lower(tm.email)") {
		t.Fatalf("accept seat query should check existing invited email, got %s", db.queryRowSQL[1])
	}
	if len(db.execSQL) != 2 {
		t.Fatalf("exec count = %d, want member upsert and invite accepted update", len(db.execSQL))
	}
	if db.execArgs[0][3] != "user_member" || db.execArgs[0][6] != string(MemberActive) {
		t.Fatalf("active member upsert args = %#v", db.execArgs[0])
	}
	if !strings.Contains(db.execSQL[1], "UPDATE team_invites") || db.execArgs[1][3] != "user_member" {
		t.Fatalf("invite update SQL/args = %s %#v", db.execSQL[1], db.execArgs[1])
	}
}

func TestAcceptInviteRejectsWhenNoReservedInviteSeatAndLimitExceeded(t *testing.T) {
	db := &fakeDB{
		queryRows: []fakeQueryRow{
			{values: []any{"member@example.com", string(RoleMember)}},
			{values: []any{1, 1, 0}},
		},
	}
	repo := NewRepository(db)

	_, err := repo.AcceptInvite(context.Background(), "tenant_1", "team_1", "invite_1", "user_member", time.Now())
	if !errors.Is(err, ErrSeatLimitExceeded) {
		t.Fatalf("AcceptInvite() error = %v, want ErrSeatLimitExceeded", err)
	}
	if len(db.execSQL) != 0 {
		t.Fatalf("execs = %d, want no writes after seat denial", len(db.execSQL))
	}
}

func TestAcceptInviteMapsMissingInvite(t *testing.T) {
	db := &fakeDB{queryRows: []fakeQueryRow{{err: pgx.ErrNoRows}}}
	repo := NewRepository(db)

	_, err := repo.AcceptInvite(context.Background(), "tenant_1", "team_1", "invite_missing", "user_member", time.Now())
	if !errors.Is(err, ErrInviteNotFound) {
		t.Fatalf("AcceptInvite() error = %v, want ErrInviteNotFound", err)
	}
}

func TestRemoveMemberDeniesOwnerOrMissingMember(t *testing.T) {
	db := &fakeDB{rowsAffected: []int64{0}}
	repo := NewRepository(db)

	err := repo.RemoveMember(context.Background(), "tenant_1", "team_1", "member_owner", "admin_1", time.Now())
	if !errors.Is(err, ErrMemberRemovalDenied) {
		t.Fatalf("RemoveMember() error = %v, want ErrMemberRemovalDenied", err)
	}
	if !strings.Contains(db.execSQL[0], "role <> 'owner'") {
		t.Fatalf("remove SQL must deny owner removal, got %s", db.execSQL[0])
	}
}

func TestGetSeatUsageAndCheckEntitlement(t *testing.T) {
	db := &fakeDB{
		queryRows: []fakeQueryRow{
			{values: []any{"team_1", "tenant_1", "plan_pro", 3, 1, 1}},
			{values: []any{"team_1", "tenant_1", "plan_pro", 2, 1, 1}},
		},
	}
	repo := NewRepository(db)

	usage, err := repo.GetSeatUsage(context.Background(), "tenant_1", "team_1")
	if err != nil {
		t.Fatalf("GetSeatUsage() error = %v", err)
	}
	if usage.BillableSeats != 2 || usage.AvailableSeats != 1 {
		t.Fatalf("usage = %#v, want billable=2 available=1", usage)
	}

	decision, err := repo.CheckSeatEntitlement(context.Background(), "tenant_1", "team_1", 1)
	if err != nil {
		t.Fatalf("CheckSeatEntitlement() error = %v", err)
	}
	if decision.Allowed || decision.Reason != "seat_limit_exceeded" || decision.Usage.BillableSeats != 2 {
		t.Fatalf("decision = %#v, want seat limit denial", decision)
	}
}

func TestAuditEventRedactsSecretsAndTargetsTeamResource(t *testing.T) {
	event := AuditEvent("tenant_1", "admin_1", "team.member_invited", "team_1", map[string]any{
		"ticket_id":    "ticket_1",
		"stripe_token": "test token value",
	}, time.Date(2026, 6, 22, 13, 0, 0, 0, time.UTC))

	if event.TenantID != "tenant_1" || event.ActorID != "admin_1" || event.Resource != "teams/team_1" {
		t.Fatalf("audit event target = %#v", event)
	}
	if event.Metadata["team_id"] != "team_1" || event.Metadata["ticket_id"] != "ticket_1" {
		t.Fatalf("audit metadata = %#v, want team_id and ticket retained", event.Metadata)
	}
	if event.Metadata["stripe_token"] != security.Redacted {
		t.Fatalf("audit metadata secret = %#v, want redacted", event.Metadata["stripe_token"])
	}
}

type fakeDB struct {
	rowsAffected []int64
	execSQL      []string
	execArgs     [][]any
	queryRows    []fakeQueryRow
	queryRowSQL  []string
	queryRowArgs [][]any
	commits      int
	rollbacks    int
}

func (f *fakeDB) Begin(context.Context) (store.Tx, error) {
	return fakeTx{fakeDB: f}, nil
}

func (f *fakeDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execSQL = append(f.execSQL, sql)
	f.execArgs = append(f.execArgs, args)
	rowsAffected := int64(1)
	if len(f.rowsAffected) >= len(f.execSQL) {
		rowsAffected = f.rowsAffected[len(f.execSQL)-1]
	}
	return pgconn.NewCommandTag(fmt.Sprintf("UPDATE %d", rowsAffected)), nil
}

func (*fakeDB) Query(context.Context, string, ...any) (store.Rows, error) {
	return &fakeRows{}, nil
}

func (f *fakeDB) QueryRow(_ context.Context, sql string, args ...any) store.Row {
	f.queryRowSQL = append(f.queryRowSQL, sql)
	f.queryRowArgs = append(f.queryRowArgs, args)
	if len(f.queryRows) == 0 {
		return fakeQueryRow{}
	}
	row := f.queryRows[0]
	f.queryRows = f.queryRows[1:]
	return row
}

type fakeTx struct {
	*fakeDB
}

func (f fakeTx) Commit(context.Context) error {
	f.commits++
	return nil
}

func (f fakeTx) Rollback(context.Context) error {
	f.rollbacks++
	return nil
}

type fakeQueryRow struct {
	values []any
	err    error
}

func (r fakeQueryRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(r.values) < len(dest) {
		return fmt.Errorf("fake row has %d values, scan wants %d", len(r.values), len(dest))
	}
	for i := range dest {
		assign(dest[i], r.values[i])
	}
	return nil
}

type fakeRows struct{}

func (*fakeRows) Close()            {}
func (*fakeRows) Err() error        { return nil }
func (*fakeRows) Next() bool        { return false }
func (*fakeRows) Scan(...any) error { return pgx.ErrNoRows }

func assign(dest any, value any) {
	switch ptr := dest.(type) {
	case *string:
		*ptr = value.(string)
	case *int:
		*ptr = value.(int)
	default:
		panic(fmt.Sprintf("unsupported scan destination %T", dest))
	}
}
