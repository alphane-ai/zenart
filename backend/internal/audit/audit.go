package audit

import (
	"context"
	"encoding/json"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

type Event struct {
	ID        string         `json:"id"`
	TenantID  string         `json:"tenant_id"`
	ActorID   string         `json:"actor_id"`
	Action    string         `json:"action"`
	Resource  string         `json:"resource"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type Recorder interface {
	Record(ctx context.Context, event Event) error
}

type NoopRecorder struct{}

func (NoopRecorder) Record(context.Context, Event) error {
	return nil
}

type PostgresRecorder struct {
	db store.DBTX
}

func NewPostgresRecorder(db store.DBTX) PostgresRecorder {
	return PostgresRecorder{db: db}
}

func (r PostgresRecorder) Record(ctx context.Context, event Event) error {
	metadata := event.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO audit_logs(id, tenant_id, actor_id, action, resource, metadata, created_at)
VALUES($1, $2, $3, $4, $5, $6, $7)`,
		event.ID,
		event.TenantID,
		event.ActorID,
		event.Action,
		event.Resource,
		encoded,
		event.CreatedAt.UTC(),
	)
	return err
}
