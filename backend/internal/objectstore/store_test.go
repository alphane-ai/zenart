package objectstore

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
)

func TestLocalStoreScopesKeysByTenant(t *testing.T) {
	store, err := NewLocalStore(t.TempDir(), "zenart-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}

	obj, err := store.Put(context.Background(), Object{
		ID:       "obj_1",
		TenantID: "tenant_1",
		Key:      "exports/package.zip",
	}, strings.NewReader("zip bytes"))
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	if !strings.HasPrefix(obj.Key, "tenants/tenant_1/") {
		t.Fatalf("key = %q, want tenant prefix", obj.Key)
	}

	reader, err := store.Get(context.Background(), "tenant_1", "exports/package.zip")
	if err != nil {
		t.Fatalf("Get() same tenant error = %v", err)
	}
	_ = reader.Body.Close()

	if _, err := store.Get(context.Background(), "tenant_2", obj.Key); !errors.Is(err, ErrTenantDenied) {
		t.Fatalf("Get() cross tenant error = %v, want ErrTenantDenied", err)
	}
}

func TestLocalStoreRejectsUnsafeTenantIDBeforeFilesystemWrite(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocalStore(root, "zenart-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}

	for _, tenantID := range []string{"../tenant_1", "tenant_1/../../escape", "tenant 1", ".tenant"} {
		_, err := store.Put(context.Background(), Object{
			TenantID: tenantID,
			Key:      "exports/package.zip",
		}, strings.NewReader("zip bytes"))
		if err == nil || !strings.Contains(err.Error(), "tenant_id is invalid") {
			t.Fatalf("Put() tenant %q error = %v, want invalid tenant_id", tenantID, err)
		}
	}
	if entries, err := os.ReadDir(root); err != nil {
		t.Fatalf("ReadDir(root) error = %v", err)
	} else if len(entries) != 0 {
		t.Fatalf("unsafe tenant write created entries: %#v", entries)
	}
}

func TestNewLocalStoreRejectsUnsafeBucketBeforeFilesystemUse(t *testing.T) {
	root := t.TempDir()
	for _, bucket := range []string{
		"../escape",
		"zenart_test",
		"ZenArt-Test",
		"zenart..test",
		"zenart.-test",
		"192.168.0.1",
		"ab",
	} {
		t.Run(bucket, func(t *testing.T) {
			if _, err := NewLocalStore(root, bucket, "secret"); err == nil || !strings.Contains(err.Error(), "object store bucket is invalid") {
				t.Fatalf("NewLocalStore() error = %v, want invalid bucket", err)
			}
		})
	}
	if entries, err := os.ReadDir(root); err != nil {
		t.Fatalf("ReadDir(root) error = %v", err)
	} else if len(entries) != 0 {
		t.Fatalf("unsafe bucket constructor created entries: %#v", entries)
	}
}

func TestLocalStoreRejectsUnsafeObjectKeyBeforeFilesystemWrite(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocalStore(root, "zenart-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}

	for _, key := range []string{"../package.zip", "exports/../package.zip", "exports//package.zip", `exports\package.zip`} {
		_, err := store.Put(context.Background(), Object{
			TenantID: "tenant_1",
			Key:      key,
		}, strings.NewReader("zip bytes"))
		if err == nil || !strings.Contains(err.Error(), "object key is invalid") {
			t.Fatalf("Put() key %q error = %v, want invalid object key", key, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "zenart-test")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unsafe object key created bucket path error = %v, want not exist", err)
	}
}

func TestLocalStoreSignedURLIncludesTenantScopedKey(t *testing.T) {
	store, err := NewLocalStore(t.TempDir(), "zenart-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}

	signed, err := store.SignGetURL(context.Background(), "tenant_1", "exports/package.zip", time.Minute)
	if err != nil {
		t.Fatalf("SignGetURL() error = %v", err)
	}
	if !strings.Contains(signed, "tenants%2Ftenant_1%2Fexports%2Fpackage.zip") {
		t.Fatalf("signed URL missing tenant-scoped key: %s", signed)
	}
	if !strings.Contains(signed, "sig=") || !strings.Contains(signed, "expires=") {
		t.Fatalf("signed URL missing signature fields: %s", signed)
	}
}

func TestLocalStorePutWritesExpiryMarkerAndDeleteRemovesObject(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocalStore(root, "zenart-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	retentionUntil := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	obj, err := store.Put(context.Background(), Object{
		TenantID:       "tenant_1",
		Key:            "exports/package.zip",
		RetentionUntil: &retentionUntil,
	}, strings.NewReader("zip bytes"))
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	objectPath := filepath.Join(root, "zenart-test", filepath.FromSlash(obj.Key))
	if _, err := os.Stat(objectPath + ".expires"); err != nil {
		t.Fatalf("expiry marker stat error = %v", err)
	}
	if err := store.Delete(context.Background(), "tenant_1", obj.Key); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := os.Stat(objectPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("object stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(objectPath + ".expires"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expiry marker stat error = %v, want not exist", err)
	}
}

func TestLocalStorePutWithoutRetentionRemovesStaleExpiryMarker(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocalStore(root, "zenart-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	retentionUntil := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	obj, err := store.Put(context.Background(), Object{
		TenantID:       "tenant_1",
		Key:            "exports/package.zip",
		RetentionUntil: &retentionUntil,
	}, strings.NewReader("old zip bytes"))
	if err != nil {
		t.Fatalf("Put() with retention error = %v", err)
	}
	objectPath := filepath.Join(root, "zenart-test", filepath.FromSlash(obj.Key))
	if _, err := os.Stat(objectPath + ".expires"); err != nil {
		t.Fatalf("expiry marker stat error = %v", err)
	}
	if _, err := store.Put(context.Background(), Object{
		TenantID: "tenant_1",
		Key:      "exports/package.zip",
	}, strings.NewReader("new zip bytes")); err != nil {
		t.Fatalf("Put() without retention error = %v", err)
	}
	if _, err := os.Stat(objectPath + ".expires"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale expiry marker stat error = %v, want not exist", err)
	}
}

func TestLocalStoreCleanupExpiredForTenantOnlyDeletesTenantMarkers(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocalStore(root, "zenart-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	expired := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	for _, tenantID := range []string{"tenant_1", "tenant_2"} {
		if _, err := store.Put(context.Background(), Object{
			TenantID:       tenantID,
			Key:            "exports/package.zip",
			RetentionUntil: &expired,
		}, strings.NewReader("zip bytes")); err != nil {
			t.Fatalf("Put(%s) error = %v", tenantID, err)
		}
	}

	deleted, err := store.CleanupExpiredForTenant(context.Background(), "tenant_1", expired.Add(time.Minute))
	if err != nil {
		t.Fatalf("CleanupExpiredForTenant() error = %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}
	if _, err := store.Get(context.Background(), "tenant_1", "exports/package.zip"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("tenant_1 object lookup error = %v, want ErrNotFound", err)
	}
	reader, err := store.Get(context.Background(), "tenant_2", "exports/package.zip")
	if err != nil {
		t.Fatalf("tenant_2 object lookup error = %v", err)
	}
	_ = reader.Body.Close()
}

func TestNewStoreSelectsS3CompatibleProvider(t *testing.T) {
	store, err := NewStore(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       "http://minio:9000",
		PublicEndpoint: "http://localhost:9000",
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	if _, ok := store.(S3Store); !ok {
		t.Fatalf("NewStore() = %T, want S3Store", store)
	}
}

func TestNewS3StoreRejectsCredentialBearingEndpoints(t *testing.T) {
	_, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       "https://access:secret@s3.example.test",
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "must not include credentials") {
		t.Fatalf("NewS3Store() error = %v, want endpoint credentials rejected", err)
	}

	_, err = NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       "https://s3.example.test",
		PublicEndpoint: "https://access:secret@downloads.example.test",
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "must not include credentials") {
		t.Fatalf("NewS3Store() public endpoint error = %v, want endpoint credentials rejected", err)
	}
}

func TestNewS3StoreRejectsUnsafeBucketBeforeRequest(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	for _, bucket := range []string{
		"../escape",
		"zenart_test",
		"ZenArt-Test",
		"zenart..test",
		"zenart-.test",
		"192.168.0.1",
		"ab",
	} {
		t.Run(bucket, func(t *testing.T) {
			_, err := NewS3Store(config.ObjectStorageConfig{
				Provider:       "s3-compatible",
				Endpoint:       server.URL,
				Region:         "us-east-1",
				Bucket:         bucket,
				AccessKey:      "access",
				SecretKey:      "secret",
				ForcePathStyle: false,
			}, server.Client())
			if err == nil || !strings.Contains(err.Error(), "object store bucket is invalid") {
				t.Fatalf("NewS3Store() error = %v, want invalid bucket", err)
			}
		})
	}
	if requests != 0 {
		t.Fatalf("unsafe bucket constructor should not send request, got %d", requests)
	}
}

func TestS3StoreSignedURLUsesTenantScopedPathStyleKey(t *testing.T) {
	store, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       "http://minio:9000",
		PublicEndpoint: "http://localhost:9000",
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, nil)
	if err != nil {
		t.Fatalf("NewS3Store() error = %v", err)
	}
	store.now = func() time.Time {
		return time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	}

	signed, err := store.SignGetURL(context.Background(), "tenant_1", "exports/package.zip", 5*time.Minute)
	if err != nil {
		t.Fatalf("SignGetURL() error = %v", err)
	}
	parsed, err := url.Parse(signed)
	if err != nil {
		t.Fatalf("signed URL parse error = %v", err)
	}
	if parsed.Scheme != "http" || parsed.Host != "localhost:9000" {
		t.Fatalf("signed URL host = %s://%s, want public endpoint", parsed.Scheme, parsed.Host)
	}
	if parsed.Path != "/zenart-test/tenants/tenant_1/exports/package.zip" {
		t.Fatalf("signed URL path = %q, want tenant-scoped path-style key", parsed.Path)
	}
	query := parsed.Query()
	for _, key := range []string{"X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders", "X-Amz-Signature"} {
		if query.Get(key) == "" {
			t.Fatalf("signed URL missing %s: %s", key, signed)
		}
	}
}

func TestS3StoreDeleteUsesTenantScopedDelete(t *testing.T) {
	var gotPaths []string
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Fatalf("method = %s, want DELETE", r.Method)
		}
		gotPaths = append(gotPaths, r.URL.Path)
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	store, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, server.Client())
	if err != nil {
		t.Fatalf("NewS3Store() error = %v", err)
	}
	if err := store.Delete(context.Background(), "tenant_1", "exports/package.zip"); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	wantPaths := []string{
		"/zenart-test/tenants/tenant_1/exports/package.zip",
		"/zenart-test/tenants/tenant_1/exports/package.zip.expires",
	}
	if len(gotPaths) != len(wantPaths) {
		t.Fatalf("paths = %#v, want %#v", gotPaths, wantPaths)
	}
	for i := range wantPaths {
		if gotPaths[i] != wantPaths[i] {
			t.Fatalf("paths = %#v, want %#v", gotPaths, wantPaths)
		}
	}
	if !strings.Contains(gotAuth, "AWS4-HMAC-SHA256") {
		t.Fatalf("authorization header missing AWS signature: %q", gotAuth)
	}
}

func TestS3StoreDeleteRejectsCrossTenantKeyBeforeRequest(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	store, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, server.Client())
	if err != nil {
		t.Fatalf("NewS3Store() error = %v", err)
	}
	if err := store.Delete(context.Background(), "tenant_1", "tenants/tenant_2/exports/package.zip"); !errors.Is(err, ErrTenantDenied) {
		t.Fatalf("Delete() error = %v, want ErrTenantDenied", err)
	}
	if requests != 0 {
		t.Fatalf("cross-tenant delete should not send request, got %d", requests)
	}
}

func TestS3StoreRejectsUnsafeTenantAndKeyBeforeRequest(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	store, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, server.Client())
	if err != nil {
		t.Fatalf("NewS3Store() error = %v", err)
	}
	if err := store.Delete(context.Background(), "tenant_1/../../tenant_2", "exports/package.zip"); err == nil || !strings.Contains(err.Error(), "tenant_id is invalid") {
		t.Fatalf("Delete() unsafe tenant error = %v, want invalid tenant_id", err)
	}
	if err := store.Delete(context.Background(), "tenant_1", "exports/../package.zip"); err == nil || !strings.Contains(err.Error(), "object key is invalid") {
		t.Fatalf("Delete() unsafe key error = %v, want invalid object key", err)
	}
	if requests != 0 {
		t.Fatalf("unsafe delete should not send request, got %d", requests)
	}
}

func TestS3StorePutWritesAndRemovesExpiryMarkers(t *testing.T) {
	var puts []string
	var deletes []string
	var markerBody string
	headersByPath := map[string]http.Header{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPut:
			puts = append(puts, r.URL.Path)
			headersByPath[r.URL.Path] = r.Header.Clone()
			if strings.HasSuffix(r.URL.Path, ".expires") {
				body, _ := io.ReadAll(r.Body)
				markerBody = string(body)
			}
			w.WriteHeader(http.StatusOK)
		case http.MethodDelete:
			deletes = append(deletes, r.URL.Path)
			if strings.HasSuffix(r.URL.Path, ".expires") {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer server.Close()

	store, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, server.Client())
	if err != nil {
		t.Fatalf("NewS3Store() error = %v", err)
	}

	retentionUntil := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	if _, err := store.Put(context.Background(), Object{
		TenantID:       "tenant_1",
		Key:            "exports/package.zip",
		ContentType:    "application/zip",
		RetentionUntil: &retentionUntil,
	}, strings.NewReader("zip bytes")); err != nil {
		t.Fatalf("Put() with retention error = %v", err)
	}
	if len(puts) != 2 {
		t.Fatalf("PUT paths = %#v, want object and marker", puts)
	}
	if puts[0] != "/zenart-test/tenants/tenant_1/exports/package.zip" || puts[1] != "/zenart-test/tenants/tenant_1/exports/package.zip.expires" {
		t.Fatalf("PUT paths = %#v, want tenant object then expiry marker", puts)
	}
	if markerBody != retentionUntil.Format(time.RFC3339) {
		t.Fatalf("marker body = %q, want %q", markerBody, retentionUntil.Format(time.RFC3339))
	}
	objectHeaders := headersByPath["/zenart-test/tenants/tenant_1/exports/package.zip"]
	if objectHeaders.Get("X-Amz-Meta-Zenart-Retention-State") != "active" {
		t.Fatalf("object retention state header = %q, want active", objectHeaders.Get("X-Amz-Meta-Zenart-Retention-State"))
	}
	if objectHeaders.Get("X-Amz-Meta-Zenart-Retention-Until") != retentionUntil.Format(time.RFC3339) {
		t.Fatalf("object retention until header = %q, want %q", objectHeaders.Get("X-Amz-Meta-Zenart-Retention-Until"), retentionUntil.Format(time.RFC3339))
	}
	if auth := objectHeaders.Get("Authorization"); !strings.Contains(auth, "x-amz-meta-zenart-retention-state") || !strings.Contains(auth, "x-amz-meta-zenart-retention-until") {
		t.Fatalf("object Authorization = %q, want signed retention metadata headers", auth)
	}
	markerHeaders := headersByPath["/zenart-test/tenants/tenant_1/exports/package.zip.expires"]
	if markerHeaders.Get("X-Amz-Meta-Zenart-Retention-Marker") != "true" {
		t.Fatalf("marker retention header = %q, want true", markerHeaders.Get("X-Amz-Meta-Zenart-Retention-Marker"))
	}
	if auth := markerHeaders.Get("Authorization"); !strings.Contains(auth, "x-amz-meta-zenart-retention-marker") {
		t.Fatalf("marker Authorization = %q, want signed marker metadata header", auth)
	}

	if _, err := store.Put(context.Background(), Object{
		TenantID:    "tenant_1",
		Key:         "exports/package.zip",
		ContentType: "application/zip",
	}, strings.NewReader("new zip bytes")); err != nil {
		t.Fatalf("Put() without retention error = %v", err)
	}
	if len(deletes) != 1 || deletes[0] != "/zenart-test/tenants/tenant_1/exports/package.zip.expires" {
		t.Fatalf("DELETE paths = %#v, want stale expiry marker delete", deletes)
	}
}

func TestS3StoreCleanupExpiredListsMarkersAndDeletesExpiredObjects(t *testing.T) {
	getBodies := map[string]string{
		"/zenart-test/tenants/tenant_1/exports/expired.zip.expires": time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC).Format(time.RFC3339),
		"/zenart-test/tenants/tenant_1/exports/live.zip.expires":    time.Date(2026, 5, 28, 12, 0, 0, 0, time.UTC).Format(time.RFC3339),
	}
	var deleted []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if r.URL.Query().Get("list-type") == "2" {
				if r.URL.Path != "/zenart-test" || r.URL.Query().Get("prefix") != "tenants/" {
					t.Fatalf("list request path/query = %s?%s", r.URL.Path, r.URL.RawQuery)
				}
				w.Header().Set("Content-Type", "application/xml")
				_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>tenants/tenant_1/exports/expired.zip.expires</Key></Contents>
  <Contents><Key>tenants/tenant_1/exports/live.zip.expires</Key></Contents>
  <Contents><Key>tenants/tenant_1/exports/expired.zip</Key></Contents>
</ListBucketResult>`))
				return
			}
			body, ok := getBodies[r.URL.Path]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write([]byte(body))
		case http.MethodDelete:
			deleted = append(deleted, r.URL.Path)
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer server.Close()

	store, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, server.Client())
	if err != nil {
		t.Fatalf("NewS3Store() error = %v", err)
	}

	deletedCount, err := store.CleanupExpired(context.Background(), time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("CleanupExpired() error = %v", err)
	}
	if deletedCount != 1 {
		t.Fatalf("CleanupExpired() deleted = %d, want 1", deletedCount)
	}
	wantDeleted := []string{
		"/zenart-test/tenants/tenant_1/exports/expired.zip",
		"/zenart-test/tenants/tenant_1/exports/expired.zip.expires",
	}
	if len(deleted) != len(wantDeleted) {
		t.Fatalf("deleted paths = %#v, want %#v", deleted, wantDeleted)
	}
	for i := range wantDeleted {
		if deleted[i] != wantDeleted[i] {
			t.Fatalf("deleted paths = %#v, want %#v", deleted, wantDeleted)
		}
	}
}

func TestS3StoreCleanupExpiredSkipsInvalidExpiryMarkers(t *testing.T) {
	getBodies := map[string]string{
		"/zenart-test/tenants/tenant_1/exports/expired.zip.expires": time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC).Format(time.RFC3339),
		"/zenart-test/tenants/tenant_1/exports/corrupt.zip.expires": "not-rfc3339",
	}
	var deleted []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if r.URL.Query().Get("list-type") == "2" {
				w.Header().Set("Content-Type", "application/xml")
				_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>tenants/tenant_1/exports/corrupt.zip.expires</Key></Contents>
  <Contents><Key>tenants/tenant_1/exports/expired.zip.expires</Key></Contents>
  <Contents><Key>exports/unscoped.zip.expires</Key></Contents>
</ListBucketResult>`))
				return
			}
			body, ok := getBodies[r.URL.Path]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write([]byte(body))
		case http.MethodDelete:
			deleted = append(deleted, r.URL.Path)
			if strings.Contains(r.URL.Path, "corrupt") || strings.Contains(r.URL.Path, "unscoped") {
				t.Fatalf("cleanup deleted invalid marker object %s", r.URL.Path)
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer server.Close()

	store, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, server.Client())
	if err != nil {
		t.Fatalf("NewS3Store() error = %v", err)
	}

	deletedCount, err := store.CleanupExpired(context.Background(), time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("CleanupExpired() error = %v", err)
	}
	if deletedCount != 1 {
		t.Fatalf("CleanupExpired() deleted = %d, want only valid expired object", deletedCount)
	}
	wantDeleted := []string{
		"/zenart-test/tenants/tenant_1/exports/expired.zip",
		"/zenart-test/tenants/tenant_1/exports/expired.zip.expires",
	}
	if len(deleted) != len(wantDeleted) {
		t.Fatalf("deleted paths = %#v, want %#v", deleted, wantDeleted)
	}
	for i := range wantDeleted {
		if deleted[i] != wantDeleted[i] {
			t.Fatalf("deleted paths = %#v, want %#v", deleted, wantDeleted)
		}
	}
}

func TestS3StoreCleanupExpiredForTenantListsTenantPrefixOnly(t *testing.T) {
	expired := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	var listPrefix string
	var deleted []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if r.URL.Query().Get("list-type") == "2" {
				listPrefix = r.URL.Query().Get("prefix")
				w.Header().Set("Content-Type", "application/xml")
				_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>tenants/tenant_1/exports/expired.zip.expires</Key></Contents>
</ListBucketResult>`))
				return
			}
			if r.URL.Path != "/zenart-test/tenants/tenant_1/exports/expired.zip.expires" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write([]byte(expired.Format(time.RFC3339)))
		case http.MethodDelete:
			deleted = append(deleted, r.URL.Path)
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer server.Close()

	store, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, server.Client())
	if err != nil {
		t.Fatalf("NewS3Store() error = %v", err)
	}

	deletedCount, err := store.CleanupExpiredForTenant(context.Background(), "tenant_1", expired.Add(time.Minute))
	if err != nil {
		t.Fatalf("CleanupExpiredForTenant() error = %v", err)
	}
	if deletedCount != 1 {
		t.Fatalf("deleted = %d, want 1", deletedCount)
	}
	if listPrefix != "tenants/tenant_1/" {
		t.Fatalf("list prefix = %q, want tenant-scoped prefix", listPrefix)
	}
	wantDeleted := []string{
		"/zenart-test/tenants/tenant_1/exports/expired.zip",
		"/zenart-test/tenants/tenant_1/exports/expired.zip.expires",
	}
	if len(deleted) != len(wantDeleted) {
		t.Fatalf("deleted paths = %#v, want %#v", deleted, wantDeleted)
	}
	for i := range wantDeleted {
		if deleted[i] != wantDeleted[i] {
			t.Fatalf("deleted paths = %#v, want %#v", deleted, wantDeleted)
		}
	}
}

func TestS3StoreCleanupExpiredForTenantIgnoresOutOfPrefixListResults(t *testing.T) {
	expired := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	var getPaths []string
	var deleted []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if r.URL.Query().Get("list-type") == "2" {
				if got := r.URL.Query().Get("prefix"); got != "tenants/tenant_1/" {
					t.Fatalf("list prefix = %q, want tenant-scoped prefix", got)
				}
				w.Header().Set("Content-Type", "application/xml")
				_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>tenants/tenant_2/exports/expired.zip.expires</Key></Contents>
  <Contents><Key>tenants/tenant_1/exports/expired.zip.expires</Key></Contents>
</ListBucketResult>`))
				return
			}
			getPaths = append(getPaths, r.URL.Path)
			if r.URL.Path != "/zenart-test/tenants/tenant_1/exports/expired.zip.expires" {
				t.Fatalf("cleanup read out-of-prefix marker %s", r.URL.Path)
			}
			_, _ = w.Write([]byte(expired.Format(time.RFC3339)))
		case http.MethodDelete:
			deleted = append(deleted, r.URL.Path)
			if strings.Contains(r.URL.Path, "/tenant_2/") {
				t.Fatalf("cleanup deleted out-of-prefix object %s", r.URL.Path)
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer server.Close()

	store, err := NewS3Store(config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	}, server.Client())
	if err != nil {
		t.Fatalf("NewS3Store() error = %v", err)
	}

	deletedCount, err := store.CleanupExpiredForTenant(context.Background(), "tenant_1", expired.Add(time.Minute))
	if err != nil {
		t.Fatalf("CleanupExpiredForTenant() error = %v", err)
	}
	if deletedCount != 1 {
		t.Fatalf("deleted = %d, want only in-prefix expired object", deletedCount)
	}
	if len(getPaths) != 1 || getPaths[0] != "/zenart-test/tenants/tenant_1/exports/expired.zip.expires" {
		t.Fatalf("marker reads = %#v, want only tenant_1 marker", getPaths)
	}
	wantDeleted := []string{
		"/zenart-test/tenants/tenant_1/exports/expired.zip",
		"/zenart-test/tenants/tenant_1/exports/expired.zip.expires",
	}
	if len(deleted) != len(wantDeleted) {
		t.Fatalf("deleted paths = %#v, want %#v", deleted, wantDeleted)
	}
	for i := range wantDeleted {
		if deleted[i] != wantDeleted[i] {
			t.Fatalf("deleted paths = %#v, want %#v", deleted, wantDeleted)
		}
	}
}

func TestHTTPProbeSignsS3CompatiblePathStyleBucketCheck(t *testing.T) {
	var gotPath string
	var gotAuth string
	var gotHash string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotHash = r.Header.Get("X-Amz-Content-Sha256")
		if r.Method != http.MethodHead {
			t.Fatalf("method = %s, want HEAD", r.Method)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	probe := NewHTTPProbe(server.Client(), config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	})

	if err := probe.Check(context.Background()); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if gotPath != "/zenart-test" {
		t.Fatalf("bucket probe path = %q, want path-style bucket path", gotPath)
	}
	if !strings.Contains(gotAuth, "AWS4-HMAC-SHA256") || !strings.Contains(gotAuth, "Credential=access/") {
		t.Fatalf("Authorization = %q, want SigV4 credential", gotAuth)
	}
	if gotHash == "" {
		t.Fatal("X-Amz-Content-Sha256 must be set for signed bucket probe")
	}
}

func TestHTTPProbeSignsS3CompatibleVirtualHostBucketCheck(t *testing.T) {
	var gotHost string
	var gotPath string
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		gotHost = r.Host
		gotPath = r.URL.Path
		if !strings.Contains(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256") {
			t.Fatalf("Authorization = %q, want SigV4 signature", r.Header.Get("Authorization"))
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader("")),
			Request:    r,
		}, nil
	})}

	probe := NewHTTPProbe(client, config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       "http://s3.example.test",
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: false,
	})

	if err := probe.Check(context.Background()); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if !strings.HasPrefix(gotHost, "zenart-test.") {
		t.Fatalf("bucket probe host = %q, want virtual-host-style bucket host", gotHost)
	}
	if gotPath != "/" {
		t.Fatalf("bucket probe path = %q, want bucket root path", gotPath)
	}
}

func TestHTTPProbeFailsClosedWhenS3CredentialsRejected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Fatal("S3-compatible probe must send signed request before interpreting auth failures")
		}
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	probe := NewHTTPProbe(server.Client(), config.ObjectStorageConfig{
		Provider:       "s3-compatible",
		Endpoint:       server.URL,
		Region:         "us-east-1",
		Bucket:         "zenart-test",
		AccessKey:      "access",
		SecretKey:      "secret",
		ForcePathStyle: true,
	})

	err := probe.Check(context.Background())
	if err == nil || !strings.Contains(err.Error(), "credentials rejected") {
		t.Fatalf("Check() error = %v, want credentials rejected error", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}
