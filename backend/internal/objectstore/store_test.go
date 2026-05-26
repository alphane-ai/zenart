package objectstore

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
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
