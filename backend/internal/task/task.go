package task

import "time"

type Status string

const (
	StatusQueued    Status = "queued"
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
	Error          *TaskError     `json:"error,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type TaskError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}
