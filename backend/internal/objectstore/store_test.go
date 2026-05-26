package objectstore

import (
	"context"
	"errors"
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
	var gotMethod, gotPath, gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
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
	if gotMethod != http.MethodDelete {
		t.Fatalf("method = %s, want DELETE", gotMethod)
	}
	if gotPath != "/zenart-test/tenants/tenant_1/exports/package.zip" {
		t.Fatalf("path = %q, want tenant-scoped path-style key", gotPath)
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
