package task

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/provider"
)

func TestPostgresBatchResultSinkPersistsObjectRefsAssetAndCanvasWithoutRawProviderOutput(t *testing.T) {
	db := &batchFakeDB{}
	objects := &batchFakeObjectStore{bucket: "zenari-stage1-results"}
	sink := NewPostgresBatchResultSink(db, objects)
	sink.Now = func() time.Time { return time.Date(2026, 6, 21, 15, 0, 0, 0, time.UTC) }
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusRunning
	batch.Children = []GenerationChildTask{child}
	input := BatchChildResultInput{
		Batch: batch,
		Child: child,
		ProviderRequest: provider.Request{
			ID:            "provider_request:child_1",
			TenantID:      child.TenantID,
			TaskID:        child.ID,
			ProviderID:    child.ProviderID,
			ModelID:       child.ModelID,
			SchemaVersion: 1,
			TraceID:       child.TraceID,
			Provenance:    provider.Provenance{RequestHash: "request_hash_1"},
		},
		ProviderResponse: provider.Response{
			ID:         "provider_response_1",
			RequestID:  "provider_request:child_1",
			ProviderID: child.ProviderID,
			ModelID:    child.ModelID,
			Status:     "succeeded",
			Output: map[string]any{
				"image_url": "https://provider.example.test/private/raw-output.png",
				"caption":   "raw generated text",
			},
			TraceID:     child.TraceID,
			CompletedAt: time.Date(2026, 6, 21, 15, 0, 0, 0, time.UTC),
		},
	}

	result, err := sink.PersistBatchChildResult(context.Background(), input)
	if err != nil {
		t.Fatalf("PersistBatchChildResult() error = %v", err)
	}
	if result.AssetID == "" || result.CanvasObjectID == "" {
		t.Fatalf("result ids = %#v", result)
	}
	if len(objects.puts) != 2 {
		t.Fatalf("object puts = %#v, want result and thumbnail objects", objects.puts)
	}
	if objects.puts[0].object.Key != "tenants/tenant_1/batch-results/batch_1/child_1/result-manifest.json" ||
		objects.puts[1].object.Key != "tenants/tenant_1/thumbnails/batch_1/child_1/thumbnail-manifest.json" {
		t.Fatalf("object keys = %#v", objects.puts)
	}
	for _, put := range objects.puts {
		payload := string(put.payload)
		if strings.Contains(payload, "provider.example.test/private/raw-output.png") || strings.Contains(payload, "raw generated text") {
			t.Fatalf("object payload leaked raw provider output: %s", payload)
		}
		if !strings.Contains(payload, `"raw_provider_payload_saved":false`) {
			t.Fatalf("object payload missing raw payload denial marker: %s", payload)
		}
	}
	if len(db.execs) != 4 {
		t.Fatalf("execs = %#v, want result metadata, thumbnail metadata, asset, and canvas inserts", db.execs)
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO object_metadata") ||
		!strings.Contains(db.execs[1].sql, "INSERT INTO object_metadata") ||
		!strings.Contains(db.execs[2].sql, "INSERT INTO assets") ||
		!strings.Contains(db.execs[3].sql, "INSERT INTO canvas_nodes") {
		t.Fatalf("exec SQLs = %#v", db.execs)
	}
	for _, exec := range db.execs {
		for _, arg := range exec.args {
			switch typed := arg.(type) {
			case []byte:
				if strings.Contains(string(typed), "provider.example.test/private/raw-output.png") || strings.Contains(string(typed), "raw generated text") {
					t.Fatalf("persisted JSON leaked raw provider output: %s", string(typed))
				}
			case string:
				if strings.Contains(typed, "provider.example.test/private/raw-output.png") || strings.Contains(typed, "raw generated text") {
					t.Fatalf("persisted arg leaked raw provider output: %s", typed)
				}
			}
		}
	}
	if db.execs[0].args[4] != "zenari-stage1-results" || db.execs[0].args[5] != objects.puts[0].object.Key {
		t.Fatalf("result object metadata bucket/key args = %#v", db.execs[0].args)
	}
	if db.execs[1].args[4] != "zenari-stage1-results" || db.execs[1].args[5] != objects.puts[1].object.Key || db.execs[1].args[9] != db.execs[0].args[0] {
		t.Fatalf("thumbnail object metadata args = %#v", db.execs[1].args)
	}
	var objectMetadata map[string]any
	if err := json.Unmarshal(db.execs[0].args[9].([]byte), &objectMetadata); err != nil {
		t.Fatalf("object metadata JSON invalid: %v", err)
	}
	if objectMetadata["storage_state"] != "object_store_ref_ready" {
		t.Fatalf("object metadata storage state = %#v", objectMetadata)
	}
	if objectMetadata["request_hash"] != "request_hash_1" {
		t.Fatalf("object metadata request hash = %#v", objectMetadata)
	}
	storageRef, ok := objectMetadata["storage_ref"].(map[string]any)
	if !ok || storageRef["object_key"] != objects.puts[0].object.Key || storageRef["checksum"] != objects.puts[0].object.Checksum {
		t.Fatalf("object metadata storage ref = %#v", objectMetadata["storage_ref"])
	}
	thumbnailRef, ok := objectMetadata["thumbnail_ref"].(map[string]any)
	if !ok || thumbnailRef["object_key"] != objects.puts[1].object.Key || thumbnailRef["checksum"] != objects.puts[1].object.Checksum {
		t.Fatalf("object metadata thumbnail ref = %#v", objectMetadata["thumbnail_ref"])
	}
	if _, ok := objectMetadata["trace_projection"].(map[string]any); !ok {
		t.Fatalf("object metadata missing trace projection: %#v", objectMetadata)
	}
	lineage, ok := objectMetadata["lineage"].(map[string]any)
	if !ok ||
		lineage["asset_id"] != result.AssetID ||
		lineage["canvas_object_id"] != result.CanvasObjectID ||
		lineage["raw_provider_payload_saved"] != false {
		t.Fatalf("object metadata lineage = %#v", objectMetadata["lineage"])
	}
	var thumbnailMetadata map[string]any
	if err := json.Unmarshal(db.execs[1].args[10].([]byte), &thumbnailMetadata); err != nil {
		t.Fatalf("thumbnail metadata JSON invalid: %v", err)
	}
	if thumbnailMetadata["derived_from_object_id"] != db.execs[0].args[0] || thumbnailMetadata["raw_provider_persisted"] != false {
		t.Fatalf("thumbnail metadata = %#v", thumbnailMetadata)
	}
	if db.execs[2].args[3] != db.execs[0].args[0] {
		t.Fatalf("asset object metadata arg = %#v, want %v", db.execs[2].args[3], db.execs[0].args[0])
	}
	var provenance map[string]any
	if err := json.Unmarshal(db.execs[2].args[4].([]byte), &provenance); err != nil {
		t.Fatalf("asset provenance JSON invalid: %v", err)
	}
	if provenance["request_hash"] != "request_hash_1" || provenance["provider_response_id"] != "provider_response_1" {
		t.Fatalf("asset provenance = %#v", provenance)
	}
	keys, ok := provenance["provider_output_keys"].([]any)
	if !ok || len(keys) != 2 {
		t.Fatalf("provider output keys = %#v", provenance["provider_output_keys"])
	}
	if _, ok := provenance["trace_projection"].(map[string]any); !ok {
		t.Fatalf("asset provenance missing trace projection: %#v", provenance)
	}
	if _, ok := provenance["thumbnail_ref"].(map[string]any); !ok {
		t.Fatalf("asset provenance missing thumbnail ref: %#v", provenance)
	}
	if result.Metadata["result_sink"] != "postgres_asset_canvas_object_store" ||
		result.Metadata["object_ref_persisted"] != "true" ||
		result.Metadata["thumbnail_persisted"] != "true" ||
		result.Metadata["lineage_persisted"] != "true" {
		t.Fatalf("result metadata = %#v", result.Metadata)
	}
}

func TestPostgresBatchResultSinkRejectsScopeDrift(t *testing.T) {
	sink := NewPostgresBatchResultSink(&batchFakeDB{}, &batchFakeObjectStore{bucket: "zenari-stage1-results"})
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	batch := validBatchGenerationRequest()
	child.TenantID = "tenant_2"

	_, err := sink.PersistBatchChildResult(context.Background(), BatchChildResultInput{
		Batch:            batch,
		Child:            child,
		ProviderRequest:  provider.Request{Provenance: provider.Provenance{RequestHash: "hash_1"}},
		ProviderResponse: provider.Response{ID: "provider_response_1"},
	})
	if err == nil {
		t.Fatal("PersistBatchChildResult() error = nil, want scope drift rejection")
	}
}

func TestPostgresBatchResultSinkRequiresObjectStore(t *testing.T) {
	sink := NewPostgresBatchResultSink(&batchFakeDB{}, nil)
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	batch := validBatchGenerationRequest()

	_, err := sink.PersistBatchChildResult(context.Background(), BatchChildResultInput{
		Batch:            batch,
		Child:            child,
		ProviderRequest:  provider.Request{Provenance: provider.Provenance{RequestHash: "hash_1"}},
		ProviderResponse: provider.Response{ID: "provider_response_1"},
	})
	if err == nil || !strings.Contains(err.Error(), "object store is required") {
		t.Fatalf("PersistBatchChildResult() error = %v, want object store required", err)
	}
}

func TestPostgresBatchResultSinkCleansObjectStoreOnDatabaseFailure(t *testing.T) {
	db := &batchFakeDB{execErrAfter: 1}
	objects := &batchFakeObjectStore{bucket: "zenari-stage1-results"}
	sink := NewPostgresBatchResultSink(db, objects)
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	batch := validBatchGenerationRequest()

	_, err := sink.PersistBatchChildResult(context.Background(), BatchChildResultInput{
		Batch: batch,
		Child: child,
		ProviderRequest: provider.Request{
			ID:         "provider_request:child_1",
			Provenance: provider.Provenance{RequestHash: "request_hash_1"},
		},
		ProviderResponse: provider.Response{ID: "provider_response_1"},
	})
	if err == nil {
		t.Fatal("PersistBatchChildResult() error = nil, want database failure")
	}
	if len(objects.puts) != 2 {
		t.Fatalf("object puts = %#v, want two writes before DB failure", objects.puts)
	}
	if len(objects.deletes) != 2 ||
		objects.deletes[0] != objects.puts[0].object.Key ||
		objects.deletes[1] != objects.puts[1].object.Key {
		t.Fatalf("object deletes = %#v, want cleanup of written result objects", objects.deletes)
	}
}

type batchFakeObjectStore struct {
	bucket  string
	puts    []batchFakeObjectPut
	deletes []string
}

type batchFakeObjectPut struct {
	object  objectstore.Object
	payload []byte
}

func (s *batchFakeObjectStore) Put(_ context.Context, object objectstore.Object, body io.Reader) (objectstore.Object, error) {
	payload, err := io.ReadAll(body)
	if err != nil {
		return objectstore.Object{}, err
	}
	if object.Bucket == "" {
		object.Bucket = s.bucket
	}
	if !strings.HasPrefix(object.Key, "tenants/"+object.TenantID+"/") {
		object.Key = "tenants/" + object.TenantID + "/" + strings.TrimPrefix(object.Key, "/")
	}
	object.ByteSize = int64(len(payload))
	object.Checksum = "sha256:" + stableID(string(payload))
	s.puts = append(s.puts, batchFakeObjectPut{object: object, payload: payload})
	return object, nil
}

func (s *batchFakeObjectStore) Get(context.Context, string, string) (objectstore.Reader, error) {
	return objectstore.Reader{}, objectstore.ErrNotFound
}

func (s *batchFakeObjectStore) SignGetURL(context.Context, string, string, time.Duration) (string, error) {
	return "", nil
}

func (s *batchFakeObjectStore) Delete(_ context.Context, _ string, key string) error {
	s.deletes = append(s.deletes, key)
	return nil
}

func (s *batchFakeObjectStore) CleanupExpired(context.Context, time.Time) (int, error) {
	return 0, nil
}

func (s *batchFakeObjectStore) CleanupExpiredForTenant(context.Context, string, time.Time) (int, error) {
	return 0, nil
}
