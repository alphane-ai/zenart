package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

type repositoryKey struct{}

type Reader interface {
	Get(ctx context.Context, tenantID, taskID string) (Task, error)
}

func ContextWithRepository(ctx context.Context, repo Reader) context.Context {
	return context.WithValue(ctx, repositoryKey{}, repo)
}

func RepositoryFromContext(ctx context.Context) (Reader, bool) {
	repo, ok := ctx.Value(repositoryKey{}).(Reader)
	return repo, ok
}

type Status string

const (
	StatusPending   Status = "pending"
	StatusRunning   Status = "running"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
	StatusCancelled Status = "cancelled"
)

type Task struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id"`
	Type           string         `json:"type"`
	SchemaVersion  int            `json:"schema_version"`
	Status         Status         `json:"status"`
	UserStatus     string         `json:"user_status"`
	IdempotencyKey string         `json:"idempotency_key,omitempty"`
	Progress       float64        `json:"progress"`
	RetryCount     int            `json:"retry_count"`
	TimeoutAt      *time.Time     `json:"timeout_at"`
	UserMessage    string         `json:"user_message"`
	AppVersion     string         `json:"app_version"`
	WorkerVersion  string         `json:"worker_version"`
	Error          *TaskError     `json:"error,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type UnsupportedSchemaError struct {
	TaskSchemaVersion int
	MaxSchemaVersion  int
}

func (e UnsupportedSchemaError) Error() string {
	return fmt.Sprintf("task schema version %d is newer than supported version %d", e.TaskSchemaVersion, e.MaxSchemaVersion)
}

func CheckSchemaCompatibility(taskSchemaVersion, maxSchemaVersion int) error {
	if taskSchemaVersion < 1 {
		return fmt.Errorf("task schema version must be >= 1: %d", taskSchemaVersion)
	}
	if maxSchemaVersion < 1 {
		return fmt.Errorf("max task schema version must be >= 1: %d", maxSchemaVersion)
	}
	if taskSchemaVersion > maxSchemaVersion {
		return UnsupportedSchemaError{
			TaskSchemaVersion: taskSchemaVersion,
			MaxSchemaVersion:  maxSchemaVersion,
		}
	}
	return nil
}

type TaskError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

type Repository struct {
	db store.DBTX
}

func NewRepository(db store.DBTX) Repository {
	return Repository{db: db}
}

func (r Repository) Get(ctx context.Context, tenantID, taskID string) (Task, error) {
	var task Task
	var errorJSON []byte
	var metadataJSON []byte
	err := r.db.QueryRow(ctx, `
SELECT id, tenant_id, type, schema_version, status, user_status, idempotency_key, progress, retry_count, timeout_at, user_message, app_version, worker_version, error, metadata, created_at, updated_at
FROM agent_tasks
WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		taskID,
	).Scan(
		&task.ID,
		&task.TenantID,
		&task.Type,
		&task.SchemaVersion,
		&task.Status,
		&task.UserStatus,
		&task.IdempotencyKey,
		&task.Progress,
		&task.RetryCount,
		&task.TimeoutAt,
		&task.UserMessage,
		&task.AppVersion,
		&task.WorkerVersion,
		&errorJSON,
		&metadataJSON,
		&task.CreatedAt,
		&task.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	if err != nil {
		return Task{}, err
	}
	if len(errorJSON) > 0 {
		var taskError TaskError
		if err := json.Unmarshal(errorJSON, &taskError); err != nil {
			return Task{}, err
		}
		task.Error = &taskError
	}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &task.Metadata); err != nil {
			return Task{}, err
		}
	}
	return task, nil
}

var ErrNotFound = errors.New("task not found")
