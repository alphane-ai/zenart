package task

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
	tracepkg "github.com/alphane-ai/zenart/backend/internal/trace"
)

type PostgresBatchResultSink struct {
	db      store.DBTX
	objects objectstore.Store
	Now     func() time.Time
}

func NewPostgresBatchResultSink(db store.DBTX, objects objectstore.Store) PostgresBatchResultSink {
	return PostgresBatchResultSink{db: db, objects: objects}
}

func (s PostgresBatchResultSink) PersistBatchChildResult(ctx context.Context, input BatchChildResultInput) (BatchChildResult, error) {
	if s.db == nil {
		return BatchChildResult{}, errors.New("batch result database is required")
	}
	if s.objects == nil {
		return BatchChildResult{}, errors.New("batch result object store is required")
	}
	if err := validateBatchChildResultInput(input); err != nil {
		return BatchChildResult{}, err
	}
	assetID := "asset_" + stableID(input.Child.ID+":provider_result")
	canvasObjectID := "canvas_node_" + stableID(input.Child.ID+":provider_result")
	objectMetadataID := "object_" + stableID(input.Child.ID+":provider_result")
	thumbnailMetadataID := "object_" + stableID(input.Child.ID+":thumbnail")
	storedResult, storedThumbnail, err := s.persistBatchResultObjects(ctx, input, objectMetadataID, thumbnailMetadataID)
	if err != nil {
		return BatchChildResult{}, err
	}
	dbPersisted := false
	defer func() {
		if !dbPersisted {
			_ = s.objects.Delete(context.Background(), input.Child.TenantID, storedResult.Key)
			_ = s.objects.Delete(context.Background(), input.Child.TenantID, storedThumbnail.Key)
		}
	}()
	assetProvenance, err := json.Marshal(batchResultAssetProvenance(input, assetID, canvasObjectID, objectMetadataID, storedResult, storedThumbnail))
	if err != nil {
		return BatchChildResult{}, err
	}
	canvasBody, err := json.Marshal(batchResultCanvasBody(input, assetID, objectMetadataID, thumbnailMetadataID, storedResult, storedThumbnail))
	if err != nil {
		return BatchChildResult{}, err
	}
	canvasMetadata, err := json.Marshal(batchResultCanvasMetadata(input, storedResult, storedThumbnail))
	if err != nil {
		return BatchChildResult{}, err
	}
	objectMetadata, err := json.Marshal(batchResultObjectMetadata(input, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID, storedResult, storedThumbnail))
	if err != nil {
		return BatchChildResult{}, err
	}
	thumbnailMetadata, err := json.Marshal(batchResultThumbnailMetadata(input, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID, storedResult, storedThumbnail))
	if err != nil {
		return BatchChildResult{}, err
	}
	if txer, ok := s.db.(store.Transactor); ok {
		tx, err := txer.Begin(ctx)
		if err != nil {
			return BatchChildResult{}, err
		}
		committed := false
		defer func() {
			if !committed {
				_ = tx.Rollback(ctx)
			}
		}()
		if err := insertBatchResultAssetAndCanvas(ctx, tx, input, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID, storedResult, storedThumbnail, assetProvenance, objectMetadata, thumbnailMetadata, canvasBody, canvasMetadata); err != nil {
			return BatchChildResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return BatchChildResult{}, err
		}
		committed = true
		dbPersisted = true
		return batchChildResult(input, assetID, canvasObjectID, storedResult, storedThumbnail), nil
	}
	if err := insertBatchResultAssetAndCanvas(ctx, s.db, input, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID, storedResult, storedThumbnail, assetProvenance, objectMetadata, thumbnailMetadata, canvasBody, canvasMetadata); err != nil {
		return BatchChildResult{}, err
	}
	dbPersisted = true
	return batchChildResult(input, assetID, canvasObjectID, storedResult, storedThumbnail), nil
}

func (s PostgresBatchResultSink) persistBatchResultObjects(ctx context.Context, input BatchChildResultInput, objectMetadataID, thumbnailMetadataID string) (objectstore.Object, objectstore.Object, error) {
	resultPayload, err := json.Marshal(batchResultStorageManifest(input, objectMetadataID, thumbnailMetadataID))
	if err != nil {
		return objectstore.Object{}, objectstore.Object{}, err
	}
	thumbnailPayload, err := json.Marshal(batchResultThumbnailManifest(input, objectMetadataID, thumbnailMetadataID))
	if err != nil {
		return objectstore.Object{}, objectstore.Object{}, err
	}
	now := s.now()
	resultObject, err := s.objects.Put(ctx, objectstore.Object{
		ID:          objectMetadataID,
		TenantID:    input.Child.TenantID,
		Key:         batchResultStorageObjectKey(input),
		ContentType: "application/vnd.zenari.batch-result+json",
		Metadata: map[string]any{
			"asset_type":            "generated_image",
			"batch_id":              input.Batch.ID,
			"child_id":              input.Child.ID,
			"provider_output_sig":   providerOutputSignature(input.ProviderResponse.Output),
			"raw_payload_persisted": false,
		},
		CreatedAt: now,
	}, bytes.NewReader(resultPayload))
	if err != nil {
		return objectstore.Object{}, objectstore.Object{}, err
	}
	thumbnailObject, err := s.objects.Put(ctx, objectstore.Object{
		ID:          thumbnailMetadataID,
		TenantID:    input.Child.TenantID,
		Key:         batchResultThumbnailObjectKey(input),
		ContentType: "application/vnd.zenari.thumbnail+json",
		Metadata: map[string]any{
			"asset_type":             "thumbnail",
			"derived_from_object_id": objectMetadataID,
			"batch_id":               input.Batch.ID,
			"child_id":               input.Child.ID,
			"raw_payload_persisted":  false,
		},
		CreatedAt: now,
	}, bytes.NewReader(thumbnailPayload))
	if err != nil {
		_ = s.objects.Delete(context.Background(), input.Child.TenantID, resultObject.Key)
		return objectstore.Object{}, objectstore.Object{}, err
	}
	return resultObject, thumbnailObject, nil
}

func insertBatchResultAssetAndCanvas(ctx context.Context, db store.DBTX, input BatchChildResultInput, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID string, storedResult, storedThumbnail objectstore.Object, assetProvenance, objectMetadata, thumbnailMetadata, canvasBody, canvasMetadata []byte) error {
	if _, err := db.Exec(ctx, `
INSERT INTO object_metadata(id, tenant_id, project_id, owner_id, asset_type, bucket, object_key, content_type, byte_size, checksum, provider, retention_state, metadata, created_at)
VALUES($1, $2, $3, $4, 'generated_image', $5, $6, $7, $8, $9, 'object-store', 'active', $10::jsonb, now())
ON CONFLICT (id) DO UPDATE
SET bucket = EXCLUDED.bucket,
	object_key = EXCLUDED.object_key,
	content_type = EXCLUDED.content_type,
	byte_size = EXCLUDED.byte_size,
	checksum = EXCLUDED.checksum,
	provider = EXCLUDED.provider,
	metadata = object_metadata.metadata || EXCLUDED.metadata,
	updated_at = now()`,
		objectMetadataID,
		input.Child.TenantID,
		input.Batch.ProjectID,
		input.Batch.UserID,
		storedResult.Bucket,
		storedResult.Key,
		storedResult.ContentType,
		storedResult.ByteSize,
		storedResult.Checksum,
		objectMetadata,
	); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
INSERT INTO object_metadata(id, tenant_id, project_id, owner_id, asset_type, bucket, object_key, content_type, byte_size, checksum, provider, retention_state, derived_from_object_id, metadata, created_at)
VALUES($1, $2, $3, $4, 'thumbnail', $5, $6, $7, $8, $9, 'object-store', 'active', $10, $11::jsonb, now())
ON CONFLICT (id) DO UPDATE
SET bucket = EXCLUDED.bucket,
	object_key = EXCLUDED.object_key,
	content_type = EXCLUDED.content_type,
	byte_size = EXCLUDED.byte_size,
	checksum = EXCLUDED.checksum,
	provider = EXCLUDED.provider,
	derived_from_object_id = EXCLUDED.derived_from_object_id,
	metadata = object_metadata.metadata || EXCLUDED.metadata,
	updated_at = now()`,
		thumbnailMetadataID,
		input.Child.TenantID,
		input.Batch.ProjectID,
		input.Batch.UserID,
		storedThumbnail.Bucket,
		storedThumbnail.Key,
		storedThumbnail.ContentType,
		storedThumbnail.ByteSize,
		storedThumbnail.Checksum,
		objectMetadataID,
		thumbnailMetadata,
	); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
INSERT INTO assets(id, tenant_id, project_id, object_metadata_id, asset_type, status, provenance, created_at, updated_at)
VALUES($1, $2, $3, $4, 'generated_image', 'active', $5::jsonb, now(), now())
ON CONFLICT (id) DO UPDATE
SET object_metadata_id = EXCLUDED.object_metadata_id,
	provenance = assets.provenance || EXCLUDED.provenance,
	updated_at = now()`,
		assetID,
		input.Child.TenantID,
		input.Batch.ProjectID,
		objectMetadataID,
		assetProvenance,
	); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
INSERT INTO canvas_nodes(id, tenant_id, workspace_id, node_type, title, body, x, y, metadata, created_at, updated_at)
VALUES($1, $2, $3, 'image', $4, $5::jsonb, 0, 0, $6::jsonb, now(), now())
ON CONFLICT (id) DO UPDATE
SET body = EXCLUDED.body,
	metadata = canvas_nodes.metadata || EXCLUDED.metadata,
	updated_at = now()`,
		canvasObjectID,
		input.Child.TenantID,
		input.Batch.WorkspaceID,
		fmt.Sprintf("Generated image %s", input.Child.ID),
		canvasBody,
		canvasMetadata,
	); err != nil {
		return err
	}
	return nil
}

func validateBatchChildResultInput(input BatchChildResultInput) error {
	if input.Batch.ID == "" || input.Child.ID == "" {
		return fmt.Errorf("%w: batch and child ids are required", ErrBatchValidation)
	}
	if input.Batch.TenantID == "" || input.Batch.ProjectID == "" || input.Batch.WorkspaceID == "" {
		return fmt.Errorf("%w: batch tenant_id, project_id, and workspace_id are required", ErrBatchValidation)
	}
	if input.Child.TenantID != input.Batch.TenantID || input.Child.BatchID != input.Batch.ID {
		return fmt.Errorf("%w: child scope must match batch scope", ErrBatchValidation)
	}
	if input.ProviderRequest.Provenance.RequestHash == "" {
		return fmt.Errorf("%w: provider request hash is required", ErrBatchValidation)
	}
	if input.ProviderResponse.ID == "" {
		return fmt.Errorf("%w: provider response id is required", ErrBatchValidation)
	}
	return nil
}

func batchChildResult(input BatchChildResultInput, assetID, canvasObjectID string, storedResult, storedThumbnail objectstore.Object) BatchChildResult {
	return BatchChildResult{
		AssetID:        assetID,
		CanvasObjectID: canvasObjectID,
		Metadata: map[string]string{
			"result_sink":          "postgres_asset_canvas_object_store",
			"asset_persisted":      "true",
			"canvas_persisted":     "true",
			"object_ref_persisted": "true",
			"thumbnail_persisted":  "true",
			"lineage_persisted":    "true",
			"trace_projection":     "object_store_manifest",
			"object_key":           storedResult.Key,
			"thumbnail_key":        storedThumbnail.Key,
			"provider_output_sig":  providerOutputSignature(input.ProviderResponse.Output),
		},
	}
}

func batchResultAssetProvenance(input BatchChildResultInput, assetID, canvasObjectID, objectMetadataID string, storedResult, storedThumbnail objectstore.Object) map[string]any {
	return map[string]any{
		"source":                   "batch_child_provider_result",
		"batch_id":                 input.Batch.ID,
		"child_id":                 input.Child.ID,
		"provider_id":              input.Child.ProviderID,
		"model_id":                 input.Child.ModelID,
		"tool_type":                input.Child.ToolType,
		"provider_response_id":     input.ProviderResponse.ID,
		"provider_response_status": input.ProviderResponse.Status,
		"request_hash":             input.ProviderRequest.Provenance.RequestHash,
		"trace_id":                 input.Child.TraceID,
		"visible_trace_ref":        input.Child.VisibleTraceRef,
		"storage_ref":              batchResultStorageRef(storedResult),
		"thumbnail_ref":            batchResultStorageRef(storedThumbnail),
		"lineage":                  batchResultLineage(input, assetID, canvasObjectID, objectMetadataID, "object_"+stableID(input.Child.ID+":thumbnail"), storedResult, storedThumbnail),
		"trace_projection":         batchResultTraceProjection(input),
		"provider_output_keys":     sortedMapKeys(input.ProviderResponse.Output),
	}
}

func batchResultCanvasBody(input BatchChildResultInput, assetID, objectMetadataID, thumbnailMetadataID string, storedResult, storedThumbnail objectstore.Object) map[string]any {
	return map[string]any{
		"asset_id":              assetID,
		"asset_type":            "generated_image",
		"object_metadata_id":    objectMetadataID,
		"thumbnail_metadata_id": thumbnailMetadataID,
		"storage_ref":           batchResultStorageRef(storedResult),
		"thumbnail_ref":         batchResultStorageRef(storedThumbnail),
		"provider_id":           input.Child.ProviderID,
		"model_id":              input.Child.ModelID,
		"tool_type":             input.Child.ToolType,
		"visible_trace_ref":     input.Child.VisibleTraceRef,
		"trace_projection":      batchResultTraceProjection(input),
	}
}

func batchResultCanvasMetadata(input BatchChildResultInput, storedResult, storedThumbnail objectstore.Object) map[string]any {
	assetID := "asset_" + stableID(input.Child.ID+":provider_result")
	canvasObjectID := "canvas_node_" + stableID(input.Child.ID+":provider_result")
	objectMetadataID := "object_" + stableID(input.Child.ID+":provider_result")
	thumbnailMetadataID := "object_" + stableID(input.Child.ID+":thumbnail")
	return map[string]any{
		"source":               "batch_child_provider_result",
		"batch_id":             input.Batch.ID,
		"child_id":             input.Child.ID,
		"storage_ref":          batchResultStorageRef(storedResult),
		"thumbnail_ref":        batchResultStorageRef(storedThumbnail),
		"trace_projection":     batchResultTraceProjection(input),
		"lineage":              batchResultLineage(input, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID, storedResult, storedThumbnail),
		"request_hash":         input.ProviderRequest.Provenance.RequestHash,
		"provider_output_sig":  providerOutputSignature(input.ProviderResponse.Output),
		"provider_output_keys": sortedMapKeys(input.ProviderResponse.Output),
	}
}

func batchResultObjectMetadata(input BatchChildResultInput, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID string, storedResult, storedThumbnail objectstore.Object) map[string]any {
	return map[string]any{
		"source":                "batch_child_provider_result",
		"storage_state":         "object_store_ref_ready",
		"asset_id":              assetID,
		"canvas_object_id":      canvasObjectID,
		"object_metadata_id":    objectMetadataID,
		"thumbnail_metadata_id": thumbnailMetadataID,
		"batch_id":              input.Batch.ID,
		"child_id":              input.Child.ID,
		"provider_id":           input.Child.ProviderID,
		"model_id":              input.Child.ModelID,
		"tool_type":             input.Child.ToolType,
		"storage_ref":           batchResultStorageRef(storedResult),
		"thumbnail_ref":         batchResultStorageRef(storedThumbnail),
		"request_hash":          input.ProviderRequest.Provenance.RequestHash,
		"provider_output_sig":   providerOutputSignature(input.ProviderResponse.Output),
		"provider_output_keys":  sortedMapKeys(input.ProviderResponse.Output),
		"trace_projection":      batchResultTraceProjection(input),
		"lineage":               batchResultLineage(input, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID, storedResult, storedThumbnail),
	}
}

func batchResultThumbnailMetadata(input BatchChildResultInput, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID string, storedResult, storedThumbnail objectstore.Object) map[string]any {
	return map[string]any{
		"source":                  "batch_child_thumbnail_manifest",
		"storage_state":           "object_store_ref_ready",
		"asset_id":                assetID,
		"canvas_object_id":        canvasObjectID,
		"object_metadata_id":      thumbnailMetadataID,
		"derived_from_object_id":  objectMetadataID,
		"batch_id":                input.Batch.ID,
		"child_id":                input.Child.ID,
		"storage_ref":             batchResultStorageRef(storedThumbnail),
		"derived_storage_ref":     batchResultStorageRef(storedResult),
		"trace_projection":        batchResultTraceProjection(input),
		"raw_provider_persisted":  false,
		"thumbnail_manifest_kind": "stage1_batch_result_thumbnail_manifest",
	}
}

func batchResultLineage(input BatchChildResultInput, assetID, canvasObjectID, objectMetadataID, thumbnailMetadataID string, storedResult, storedThumbnail objectstore.Object) map[string]any {
	return map[string]any{
		"source":                     "batch_child_provider_result",
		"asset_id":                   assetID,
		"canvas_object_id":           canvasObjectID,
		"object_metadata_id":         objectMetadataID,
		"thumbnail_metadata_id":      thumbnailMetadataID,
		"storage_ref":                batchResultStorageRef(storedResult),
		"thumbnail_ref":              batchResultStorageRef(storedThumbnail),
		"batch_id":                   input.Batch.ID,
		"child_id":                   input.Child.ID,
		"provider_id":                input.Child.ProviderID,
		"model_id":                   input.Child.ModelID,
		"tool_type":                  input.Child.ToolType,
		"request_hash":               input.ProviderRequest.Provenance.RequestHash,
		"provider_response_id":       input.ProviderResponse.ID,
		"raw_provider_payload_saved": false,
	}
}

func batchResultTraceProjection(input BatchChildResultInput) map[string]any {
	prompt, err := tracepkg.BuildPromptContextPayload(tracepkg.PromptContextInput{
		Text:              input.Batch.PromptContext.Text,
		SelectedObjectIDs: input.Batch.PromptContext.SelectedObjectIDs,
		ReferenceAssetIDs: input.Batch.PromptContext.ReferenceAssetIDs,
		BrandKitID:        input.Batch.PromptContext.BrandKitID,
		ModelHints:        input.Batch.PromptContext.ModelHints,
		ToolHint:          input.Batch.PromptContext.ToolHint,
	})
	if err != nil {
		return batchResultFallbackTraceProjection(input, err)
	}
	projection, err := tracepkg.BuildTraceProjection(tracepkg.TraceProjectionInput{
		TraceID:                input.Child.TraceID,
		VisibleTraceRef:        input.Child.VisibleTraceRef,
		BatchID:                input.Batch.ID,
		ChildID:                input.Child.ID,
		TaskID:                 input.Child.ID,
		Workflow:               tracepkg.WorkflowBatchGeneration,
		TaskStatus:             string(input.Child.Status),
		ProviderID:             input.Child.ProviderID,
		ModelID:                input.Child.ModelID,
		ToolType:               input.Child.ToolType,
		ProviderRequestHash:    input.ProviderRequest.Provenance.RequestHash,
		ProviderResponseID:     input.ProviderResponse.ID,
		ProviderResponseStatus: input.ProviderResponse.Status,
		PromptContext:          prompt,
		AssetIDs:               []string{"asset_" + stableID(input.Child.ID+":provider_result")},
		CanvasObjectIDs:        []string{"canvas_node_" + stableID(input.Child.ID+":provider_result")},
		FinalExportAllowed:     true,
		DownloadEnabled:        true,
	})
	if err != nil {
		return batchResultFallbackTraceProjection(input, err)
	}
	return projection.Map()
}

func batchResultFallbackTraceProjection(input BatchChildResultInput, err error) map[string]any {
	return map[string]any{
		"trace_id":                     input.Child.TraceID,
		"visible_trace_ref":            input.Child.VisibleTraceRef,
		"task_id":                      input.Child.ID,
		"workflow":                     tracepkg.WorkflowBatchGeneration,
		"task_status":                  string(input.Child.Status),
		"provider_id":                  input.Child.ProviderID,
		"model_id":                     input.Child.ModelID,
		"tool_type":                    input.Child.ToolType,
		"provider_response_id":         input.ProviderResponse.ID,
		"provider_response_status":     input.ProviderResponse.Status,
		"request_hash":                 input.ProviderRequest.Provenance.RequestHash,
		"projection_error":             security.RedactString(err.Error()),
		"raw_prompt_projected":         false,
		"raw_provider_payload_saved":   false,
		"raw_safety_payload_projected": false,
	}
}

func tenantScopedBatchResultObjectKey(input BatchChildResultInput) string {
	return strings.Join([]string{
		"batch-results",
		input.Batch.ID,
		input.Child.ID,
		"result-manifest.json",
	}, "/")
}

func batchResultStorageObjectKey(input BatchChildResultInput) string {
	return tenantScopedBatchResultObjectKey(input)
}

func batchResultThumbnailObjectKey(input BatchChildResultInput) string {
	return strings.Join([]string{
		"thumbnails",
		input.Batch.ID,
		input.Child.ID,
		"thumbnail-manifest.json",
	}, "/")
}

func batchResultStorageManifest(input BatchChildResultInput, objectMetadataID, thumbnailMetadataID string) map[string]any {
	return map[string]any{
		"manifest_kind":              "stage1_batch_result_manifest",
		"tenant_id":                  input.Child.TenantID,
		"project_id":                 input.Batch.ProjectID,
		"workspace_id":               input.Batch.WorkspaceID,
		"batch_id":                   input.Batch.ID,
		"child_id":                   input.Child.ID,
		"object_metadata_id":         objectMetadataID,
		"thumbnail_metadata_id":      thumbnailMetadataID,
		"provider_id":                input.Child.ProviderID,
		"model_id":                   input.Child.ModelID,
		"tool_type":                  input.Child.ToolType,
		"provider_response_id":       input.ProviderResponse.ID,
		"provider_response_status":   input.ProviderResponse.Status,
		"request_hash":               input.ProviderRequest.Provenance.RequestHash,
		"provider_output_sig":        providerOutputSignature(input.ProviderResponse.Output),
		"provider_output_keys":       sortedMapKeys(input.ProviderResponse.Output),
		"trace_projection":           batchResultTraceProjection(input),
		"raw_provider_payload_saved": false,
	}
}

func batchResultThumbnailManifest(input BatchChildResultInput, objectMetadataID, thumbnailMetadataID string) map[string]any {
	return map[string]any{
		"manifest_kind":              "stage1_batch_thumbnail_manifest",
		"tenant_id":                  input.Child.TenantID,
		"project_id":                 input.Batch.ProjectID,
		"batch_id":                   input.Batch.ID,
		"child_id":                   input.Child.ID,
		"object_metadata_id":         thumbnailMetadataID,
		"derived_from_object_id":     objectMetadataID,
		"provider_id":                input.Child.ProviderID,
		"model_id":                   input.Child.ModelID,
		"request_hash":               input.ProviderRequest.Provenance.RequestHash,
		"provider_output_sig":        providerOutputSignature(input.ProviderResponse.Output),
		"raw_provider_payload_saved": false,
		"placeholder_promoted":       false,
	}
}

func batchResultStorageRef(object objectstore.Object) map[string]any {
	return map[string]any{
		"bucket":       object.Bucket,
		"object_key":   object.Key,
		"content_type": object.ContentType,
		"byte_size":    object.ByteSize,
		"checksum":     object.Checksum,
	}
}

func sortedMapKeys(input map[string]any) []string {
	keys := make([]string, 0, len(input))
	for key := range input {
		key = strings.TrimSpace(key)
		if key != "" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

func providerOutputSignature(output map[string]any) string {
	keys := sortedMapKeys(output)
	sum := sha256.Sum256([]byte(strings.Join(keys, ",")))
	return hex.EncodeToString(sum[:])
}

func (s PostgresBatchResultSink) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}
