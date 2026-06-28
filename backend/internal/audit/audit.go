package audit

import (
	"context"
	"encoding/json"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
)

type searcherKey struct{}
type recorderKey struct{}

type Event struct {
	ID        string         `json:"id"`
	AuditRef  string         `json:"audit_ref,omitempty"`
	TenantID  string         `json:"tenant_id"`
	ActorID   string         `json:"actor_id"`
	Action    string         `json:"action"`
	Resource  string         `json:"resource"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type SearchFilters struct {
	TenantID string
	ActorID  string
	Action   string
	Resource string
	Limit    int
}

type Page struct {
	Items         []Event `json:"items"`
	NextPageToken string  `json:"next_page_token,omitempty"`
}

type Recorder interface {
	Record(ctx context.Context, event Event) error
}

type Searcher interface {
	Search(ctx context.Context, filters SearchFilters) (Page, error)
}

type NoopRecorder struct{}

func (NoopRecorder) Record(context.Context, Event) error {
	return nil
}

func ContextWithSearcher(ctx context.Context, searcher Searcher) context.Context {
	return context.WithValue(ctx, searcherKey{}, searcher)
}

func SearcherFromContext(ctx context.Context) (Searcher, bool) {
	searcher, ok := ctx.Value(searcherKey{}).(Searcher)
	return searcher, ok
}

func ContextWithRecorder(ctx context.Context, recorder Recorder) context.Context {
	return context.WithValue(ctx, recorderKey{}, recorder)
}

func RecorderFromContext(ctx context.Context) (Recorder, bool) {
	recorder, ok := ctx.Value(recorderKey{}).(Recorder)
	return recorder, ok
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
	metadata = security.RedactMap(metadata)
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

func (r PostgresRecorder) Search(ctx context.Context, filters SearchFilters) (Page, error) {
	limit := filters.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := r.db.Query(ctx, `
SELECT id, tenant_id, actor_id, action, resource, metadata, created_at
FROM audit_logs
WHERE tenant_id = $1
  AND ($2 = '' OR actor_id = $2)
  AND ($3 = '' OR action = $3)
  AND ($4 = '' OR resource = $4)
ORDER BY created_at DESC, id DESC
LIMIT $5`,
		filters.TenantID,
		filters.ActorID,
		filters.Action,
		filters.Resource,
		limit,
	)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()

	page := Page{Items: []Event{}}
	for rows.Next() {
		var event Event
		var metadata []byte
		if err := rows.Scan(&event.ID, &event.TenantID, &event.ActorID, &event.Action, &event.Resource, &metadata, &event.CreatedAt); err != nil {
			return Page{}, err
		}
		if len(metadata) > 0 {
			_ = json.Unmarshal(metadata, &event.Metadata)
		}
		event.Metadata = security.RedactMap(event.Metadata)
		event.AuditRef = event.ID
		page.Items = append(page.Items, event)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	return page, nil
}
