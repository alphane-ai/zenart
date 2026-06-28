package canvas

import (
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"
)

type CanvasVersionSnapshot struct {
	ID            string         `json:"id"`
	TenantID      string         `json:"tenant_id"`
	WorkspaceID   string         `json:"workspace_id"`
	VersionNumber int            `json:"version_number"`
	Label         string         `json:"label"`
	Objects       []CanvasObject `json:"objects"`
	CreatedBy     string         `json:"created_by"`
	CreatedAt     time.Time      `json:"created_at"`
}

type CanvasObjectVersion struct {
	ObjectID      string       `json:"object_id"`
	VersionID     string       `json:"version_id"`
	VersionNumber int          `json:"version_number"`
	Operation     string       `json:"operation"`
	Object        CanvasObject `json:"object"`
	CreatedAt     time.Time    `json:"created_at"`
}

type CanvasVersionDiff struct {
	FromVersionID      string   `json:"from_version_id"`
	ToVersionID        string   `json:"to_version_id"`
	AddedObjectIDs     []string `json:"added_object_ids"`
	RemovedObjectIDs   []string `json:"removed_object_ids"`
	UpdatedObjectIDs   []string `json:"updated_object_ids"`
	UnchangedObjectIDs []string `json:"unchanged_object_ids"`
}

type CanvasRestorePlan struct {
	VersionID          string   `json:"version_id"`
	RestoredObjectIDs  []string `json:"restored_object_ids"`
	PreservedObjectIDs []string `json:"preserved_object_ids"`
	ConflictObjectIDs  []string `json:"conflict_object_ids"`
	ObjectCountBefore  int      `json:"object_count_before"`
	ObjectCountAfter   int      `json:"object_count_after"`
}

type canvasObjectComparable struct {
	FrameID    string
	ObjectType ObjectType
	Title      string
	Body       map[string]any
	Transform  Transform
	ZIndex     int
	Locked     bool
	Hidden     bool
	AssetRef   AssetRef
	LineageRef LineageRef
	Metadata   map[string]any
}

func CreateVersionSnapshot(tenantID, workspaceID, versionID string, versionNumber int, label, createdBy string, objects []CanvasObject, createdAt time.Time) (CanvasVersionSnapshot, error) {
	tenantID = strings.TrimSpace(tenantID)
	workspaceID = strings.TrimSpace(workspaceID)
	versionID = strings.TrimSpace(versionID)
	createdBy = strings.TrimSpace(createdBy)
	if tenantID == "" || workspaceID == "" || versionID == "" || createdBy == "" {
		return CanvasVersionSnapshot{}, fmt.Errorf("%w: tenant_id, workspace_id, version_id, and created_by are required", ErrValidation)
	}
	if versionNumber <= 0 {
		return CanvasVersionSnapshot{}, fmt.Errorf("%w: version_number must be positive", ErrValidation)
	}
	if strings.TrimSpace(label) == "" {
		label = fmt.Sprintf("Version %d", versionNumber)
	}
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}

	snapshot := CanvasVersionSnapshot{
		ID:            versionID,
		TenantID:      tenantID,
		WorkspaceID:   workspaceID,
		VersionNumber: versionNumber,
		Label:         label,
		Objects:       make([]CanvasObject, 0, len(objects)),
		CreatedBy:     createdBy,
		CreatedAt:     createdAt,
	}
	for _, object := range objects {
		if err := EnsureTenant(tenantID, object); err != nil {
			return CanvasVersionSnapshot{}, err
		}
		if strings.TrimSpace(object.WorkspaceID) != workspaceID {
			return CanvasVersionSnapshot{}, fmt.Errorf("%w: object %s workspace mismatch", ErrValidation, object.ID)
		}
		if err := ValidateCanvasObject(object); err != nil {
			return CanvasVersionSnapshot{}, err
		}
		copy := cloneCanvasObject(object)
		copy.VersionID = versionID
		snapshot.Objects = append(snapshot.Objects, copy)
	}
	sortCanvasObjects(snapshot.Objects)
	return snapshot, nil
}

func DiffVersionSnapshots(from, to CanvasVersionSnapshot) (CanvasVersionDiff, error) {
	if err := validateComparableSnapshots(from, to); err != nil {
		return CanvasVersionDiff{}, err
	}
	diff := CanvasVersionDiff{
		FromVersionID: from.ID,
		ToVersionID:   to.ID,
	}
	fromObjects := canvasObjectsByID(from.Objects)
	toObjects := canvasObjectsByID(to.Objects)

	for id, toObject := range toObjects {
		fromObject, ok := fromObjects[id]
		switch {
		case !ok:
			diff.AddedObjectIDs = append(diff.AddedObjectIDs, id)
		case reflect.DeepEqual(comparableCanvasObject(fromObject), comparableCanvasObject(toObject)):
			diff.UnchangedObjectIDs = append(diff.UnchangedObjectIDs, id)
		default:
			diff.UpdatedObjectIDs = append(diff.UpdatedObjectIDs, id)
		}
	}
	for id := range fromObjects {
		if _, ok := toObjects[id]; !ok {
			diff.RemovedObjectIDs = append(diff.RemovedObjectIDs, id)
		}
	}
	sort.Strings(diff.AddedObjectIDs)
	sort.Strings(diff.RemovedObjectIDs)
	sort.Strings(diff.UpdatedObjectIDs)
	sort.Strings(diff.UnchangedObjectIDs)
	return diff, nil
}

func RestoreWorkspaceVersion(current []CanvasObject, snapshot CanvasVersionSnapshot, restoredAt time.Time) ([]CanvasObject, CanvasRestorePlan, error) {
	objectIDs := make([]string, 0, len(snapshot.Objects))
	for _, object := range snapshot.Objects {
		objectIDs = append(objectIDs, object.ID)
	}
	return RestoreObjectVersions(current, snapshot, objectIDs, restoredAt)
}

func RestoreObjectVersions(current []CanvasObject, snapshot CanvasVersionSnapshot, objectIDs []string, restoredAt time.Time) ([]CanvasObject, CanvasRestorePlan, error) {
	if err := validateSnapshot(snapshot); err != nil {
		return nil, CanvasRestorePlan{}, err
	}
	if restoredAt.IsZero() {
		restoredAt = time.Now().UTC()
	}
	requestedIDs := normalizeObjectIDs(objectIDs)
	if len(requestedIDs) == 0 {
		return nil, CanvasRestorePlan{}, fmt.Errorf("%w: at least one object_id is required", ErrValidation)
	}

	snapshotObjects := canvasObjectsByID(snapshot.Objects)
	currentObjects := canvasObjectsByID(current)
	resultObjects := make(map[string]CanvasObject, len(currentObjects)+len(requestedIDs))
	plan := CanvasRestorePlan{
		VersionID:         snapshot.ID,
		ObjectCountBefore: len(current),
	}
	for _, object := range current {
		if strings.TrimSpace(object.TenantID) != snapshot.TenantID || strings.TrimSpace(object.WorkspaceID) != snapshot.WorkspaceID {
			plan.ConflictObjectIDs = append(plan.ConflictObjectIDs, object.ID)
		}
		resultObjects[object.ID] = cloneCanvasObject(object)
	}

	for _, objectID := range requestedIDs {
		snapshotObject, ok := snapshotObjects[objectID]
		if !ok {
			return nil, CanvasRestorePlan{}, fmt.Errorf("%w: version %s does not contain object %s", ErrValidation, snapshot.ID, objectID)
		}
		if currentObject, ok := currentObjects[objectID]; ok {
			if strings.TrimSpace(currentObject.TenantID) != snapshot.TenantID || strings.TrimSpace(currentObject.WorkspaceID) != snapshot.WorkspaceID {
				plan.ConflictObjectIDs = append(plan.ConflictObjectIDs, objectID)
				continue
			}
		}
		restored := cloneCanvasObject(snapshotObject)
		restored.VersionID = snapshot.ID
		restored.UpdatedAt = restoredAt
		if existing, ok := currentObjects[objectID]; ok {
			restored.CreatedAt = existing.CreatedAt
		}
		resultObjects[objectID] = restored
		plan.RestoredObjectIDs = append(plan.RestoredObjectIDs, objectID)
	}

	restoredSet := make(map[string]struct{}, len(plan.RestoredObjectIDs))
	for _, id := range plan.RestoredObjectIDs {
		restoredSet[id] = struct{}{}
	}
	for id := range resultObjects {
		if _, ok := restoredSet[id]; !ok {
			plan.PreservedObjectIDs = append(plan.PreservedObjectIDs, id)
		}
	}

	result := make([]CanvasObject, 0, len(resultObjects))
	for _, object := range resultObjects {
		result = append(result, object)
	}
	sortCanvasObjects(result)
	sort.Strings(plan.RestoredObjectIDs)
	sort.Strings(plan.PreservedObjectIDs)
	plan.ConflictObjectIDs = uniqueSorted(plan.ConflictObjectIDs)
	plan.ObjectCountAfter = len(result)
	return result, plan, nil
}

func TenantScopedListVersionsSQL() string {
	return `
SELECT id, tenant_id, workspace_id, version_number, label, snapshot, created_by, created_at
FROM canvas_versions
WHERE tenant_id = $1 AND workspace_id = $2
ORDER BY version_number DESC, id DESC
LIMIT $3`
}

func TenantScopedCreateVersionSQL() string {
	return `
INSERT INTO canvas_versions(id, tenant_id, workspace_id, version_number, label, snapshot, created_by, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (workspace_id, version_number) DO NOTHING`
}

func validateSnapshot(snapshot CanvasVersionSnapshot) error {
	if strings.TrimSpace(snapshot.ID) == "" || strings.TrimSpace(snapshot.TenantID) == "" || strings.TrimSpace(snapshot.WorkspaceID) == "" {
		return fmt.Errorf("%w: version id, tenant_id, and workspace_id are required", ErrValidation)
	}
	for _, object := range snapshot.Objects {
		if err := EnsureTenant(snapshot.TenantID, object); err != nil {
			return err
		}
		if strings.TrimSpace(object.WorkspaceID) != strings.TrimSpace(snapshot.WorkspaceID) {
			return fmt.Errorf("%w: object %s workspace mismatch", ErrValidation, object.ID)
		}
		if err := ValidateCanvasObject(object); err != nil {
			return err
		}
	}
	return nil
}

func validateComparableSnapshots(from, to CanvasVersionSnapshot) error {
	if err := validateSnapshot(from); err != nil {
		return err
	}
	if err := validateSnapshot(to); err != nil {
		return err
	}
	if strings.TrimSpace(from.TenantID) != strings.TrimSpace(to.TenantID) || strings.TrimSpace(from.WorkspaceID) != strings.TrimSpace(to.WorkspaceID) {
		return fmt.Errorf("%w: version snapshots must share tenant and workspace", ErrValidation)
	}
	return nil
}

func canvasObjectsByID(objects []CanvasObject) map[string]CanvasObject {
	byID := make(map[string]CanvasObject, len(objects))
	for _, object := range objects {
		if strings.TrimSpace(object.ID) == "" {
			continue
		}
		byID[object.ID] = cloneCanvasObject(object)
	}
	return byID
}

func comparableCanvasObject(object CanvasObject) canvasObjectComparable {
	return canvasObjectComparable{
		FrameID:    object.FrameID,
		ObjectType: object.ObjectType,
		Title:      object.Title,
		Body:       cloneMap(object.Body),
		Transform:  object.Transform,
		ZIndex:     object.ZIndex,
		Locked:     object.Locked,
		Hidden:     object.Hidden,
		AssetRef:   object.AssetRef,
		LineageRef: object.LineageRef,
		Metadata:   cloneMap(object.Metadata),
	}
}

func normalizeObjectIDs(objectIDs []string) []string {
	seen := make(map[string]struct{}, len(objectIDs))
	normalized := make([]string, 0, len(objectIDs))
	for _, objectID := range objectIDs {
		objectID = strings.TrimSpace(objectID)
		if objectID == "" {
			continue
		}
		if _, ok := seen[objectID]; ok {
			continue
		}
		seen[objectID] = struct{}{}
		normalized = append(normalized, objectID)
	}
	sort.Strings(normalized)
	return normalized
}

func uniqueSorted(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	sort.Strings(unique)
	return unique
}

func sortCanvasObjects(objects []CanvasObject) {
	sort.SliceStable(objects, func(i, j int) bool {
		if objects[i].ZIndex == objects[j].ZIndex {
			return objects[i].ID < objects[j].ID
		}
		return objects[i].ZIndex < objects[j].ZIndex
	})
}

func cloneCanvasObject(object CanvasObject) CanvasObject {
	copy := object
	copy.Body = cloneMap(object.Body)
	copy.Metadata = cloneMap(object.Metadata)
	return copy
}

func cloneMap(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func IsVersionValidationError(err error) bool {
	return errors.Is(err, ErrValidation) || errors.Is(err, ErrTenantDenied)
}
