package worker

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/agent"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
)

func TestClaimNextClaimsOnlySupportedPendingSchema(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{
		row: fakeRow{values: []any{
			"task_1",
			"tenant_1",
			agent.ContractCandidateSetBuilder,
			1,
			task.StatusRunning,
			"running",
			"idem_1",
			1.0,
			0,
			now.Add(15 * time.Minute),
			"Worker claimed task",
			"stage0-local",
			"worker-test",
			[]byte(`null`),
			[]byte(`{"project_id":"project_1"}`),
			now,
			now,
		}},
	}
	repo := NewRepository(db)

	claimed, err := repo.ClaimNext(context.Background(), ClaimOptions{
		SchemaVersion: 1,
		InstanceID:    "instance-test",
		WorkerVersion: "worker-test",
		Timeout:       15 * time.Minute,
		TaskTypes:     []string{agent.ContractCandidateSetBuilder},
	})
	if err != nil {
		t.Fatalf("ClaimNext() error = %v", err)
	}
	if claimed.ID != "task_1" || claimed.Status != task.StatusRunning {
		t.Fatalf("claimed task = %#v", claimed)
	}
	if claimed.Metadata["project_id"] != "project_1" {
		t.Fatalf("metadata = %#v", claimed.Metadata)
	}
	if !strings.Contains(db.query, "schema_version <= $1") {
		t.Fatalf("claim query must guard schema version: %s", db.query)
	}
	if !strings.Contains(db.query, "type = ANY($5)") {
		t.Fatalf("claim query must restrict supported task types: %s", db.query)
	}
	if !strings.Contains(db.query, "FOR UPDATE SKIP LOCKED") {
		t.Fatalf("claim query must skip locked rows: %s", db.query)
	}
	if got := db.args[4].([]string); len(got) != 1 || got[0] != agent.ContractCandidateSetBuilder {
		t.Fatalf("task type args = %#v", db.args[4])
	}
	claimMetadata, ok := db.args[5].([]byte)
	if !ok || !strings.Contains(string(claimMetadata), "instance-test") {
		t.Fatalf("claim metadata = %#v", db.args[5])
	}
}

func TestClaimNextReturnsErrNoTask(t *testing.T) {
	db := &fakeDB{row: fakeRow{err: pgx.ErrNoRows}}
	repo := NewRepository(db)

	_, err := repo.ClaimNext(context.Background(), ClaimOptions{
		SchemaVersion: 1,
		InstanceID:    "instance-test",
		WorkerVersion: "worker-test",
		Timeout:       time.Minute,
		TaskTypes:     []string{agent.ContractCandidateSetBuilder},
	})
	if !errors.Is(err, ErrNoTask) {
		t.Fatalf("ClaimNext() error = %v, want ErrNoTask", err)
	}
}

func TestDrainOwnedFailsOnlyOwnedRunningTasks(t *testing.T) {
	db := &fakeDB{commandTag: pgconn.NewCommandTag("UPDATE 2")}
	repo := NewRepository(db)

	drained, err := repo.DrainOwned(context.Background(), "worker-test", "instance-test")
	if err != nil {
		t.Fatalf("DrainOwned() error = %v", err)
	}
	if drained != 2 {
		t.Fatalf("drained = %d, want 2", drained)
	}
	if !strings.Contains(db.execSQL, "WHERE status = 'running'") {
		t.Fatalf("drain query must only affect running rows: %s", db.execSQL)
	}
	if !strings.Contains(db.execSQL, "worker_version = $1") {
		t.Fatalf("drain query must only affect this worker version: %s", db.execSQL)
	}
	if !strings.Contains(db.execSQL, "worker_instance_id") {
		t.Fatalf("drain query must only affect this worker instance: %s", db.execSQL)
	}
	errorJSON, ok := db.execArgs[1].([]byte)
	if !ok || !strings.Contains(string(errorJSON), "worker_drained") {
		t.Fatalf("drain error payload = %#v", db.execArgs[1])
	}
	if db.execArgs[3] != "instance-test" {
		t.Fatalf("worker instance arg = %#v", db.execArgs[3])
	}
}

func TestNewRunnerPassesSupportedTaskTypesToClaim(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)
	runner := NewRunner(repo, nil, agent.BaseStepContracts(1), Options{
		SchemaVersion: 1,
		InstanceID:    "instance-test",
		WorkerVersion: "worker-test",
		PollInterval:  time.Hour,
		ClaimTimeout:  time.Minute,
	})

	if len(runner.taskTypes) != len(agent.BaseStepContracts(1)) {
		t.Fatalf("taskTypes len = %d, want %d", len(runner.taskTypes), len(agent.BaseStepContracts(1)))
	}
	for _, taskType := range runner.taskTypes {
		if _, ok := runner.contracts[taskType]; !ok {
			t.Fatalf("task type %q missing contract", taskType)
		}
	}
}

func TestRunnerDrainUsesConfiguredWorkerIdentity(t *testing.T) {
	db := &fakeDB{commandTag: pgconn.NewCommandTag("UPDATE 1")}
	repo := NewRepository(db)
	runner := NewRunner(repo, nil, agent.BaseStepContracts(1), Options{
		SchemaVersion: 1,
		InstanceID:    "instance-test",
		WorkerVersion: "worker-test",
		PollInterval:  time.Hour,
		ClaimTimeout:  time.Minute,
	})

	drained, err := runner.Drain(context.Background())
	if err != nil {
		t.Fatalf("Drain() error = %v", err)
	}
	if drained != 1 {
		t.Fatalf("drained = %d, want 1", drained)
	}
	if db.execArgs[0] != "worker-test" {
		t.Fatalf("worker version arg = %#v, want worker-test", db.execArgs[0])
	}
	if db.execArgs[3] != "instance-test" {
		t.Fatalf("worker instance arg = %#v, want instance-test", db.execArgs[3])
	}
}

type fakeDB struct {
	query      string
	args       []any
	row        fakeRow
	execSQL    string
	execArgs   []any
	commandTag pgconn.CommandTag
}

func (f *fakeDB) Exec(_ context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	f.execSQL = sql
	f.execArgs = arguments
	return f.commandTag, nil
}

func (f *fakeDB) Query(context.Context, string, ...any) (store.Rows, error) {
	return nil, errors.New("unexpected Query")
}

func (f *fakeDB) QueryRow(_ context.Context, sql string, args ...any) store.Row {
	f.query = sql
	f.args = args
	return f.row
}

type fakeRow struct {
	values []any
	err    error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i := range dest {
		assign(dest[i], r.values[i])
	}
	return nil
}

func assign(dest any, value any) {
	switch ptr := dest.(type) {
	case *string:
		*ptr = value.(string)
	case *int:
		*ptr = value.(int)
	case *float64:
		*ptr = value.(float64)
	case *task.Status:
		*ptr = value.(task.Status)
	case **time.Time:
		v := value.(time.Time)
		*ptr = &v
	case *[]byte:
		*ptr = value.([]byte)
	case *time.Time:
		*ptr = value.(time.Time)
	default:
		panic("unsupported scan destination")
	}
}
