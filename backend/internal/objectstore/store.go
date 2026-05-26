package objectstore

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
)

var (
	ErrNotFound     = errors.New("object not found")
	ErrTenantDenied = errors.New("object tenant denied")
)

var tenantIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

type Object struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id"`
	Bucket         string         `json:"bucket"`
	Key            string         `json:"object_key"`
	ContentType    string         `json:"content_type"`
	ByteSize       int64          `json:"byte_size"`
	Checksum       string         `json:"checksum"`
	RetentionUntil *time.Time     `json:"retention_until,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

type Reader struct {
	Object Object
	Body   io.ReadCloser
}

type Store interface {
	Put(ctx context.Context, object Object, body io.Reader) (Object, error)
	Get(ctx context.Context, tenantID, key string) (Reader, error)
	SignGetURL(ctx context.Context, tenantID, key string, ttl time.Duration) (string, error)
	Delete(ctx context.Context, tenantID, key string) error
	CleanupExpired(ctx context.Context, now time.Time) (int, error)
}

func NewStore(cfg config.ObjectStorageConfig, client *http.Client) (Store, error) {
	switch cfg.Provider {
	case "local":
		return NewLocalStore(cfg.LocalRoot, cfg.Bucket, cfg.SigningKey)
	case "s3-compatible":
		return NewS3Store(cfg, client)
	default:
		return nil, fmt.Errorf("unsupported object storage provider %q", cfg.Provider)
	}
}

type LocalStore struct {
	root       string
	bucket     string
	signingKey []byte
	now        func() time.Time
}

func NewLocalStore(root, bucket, signingSecret string) (LocalStore, error) {
	root = strings.TrimSpace(root)
	bucket = strings.TrimSpace(bucket)
	if root == "" {
		return LocalStore{}, errors.New("local object store root is required")
	}
	if bucket == "" {
		return LocalStore{}, errors.New("object store bucket is required")
	}
	if signingSecret == "" {
		signingSecret = "stage0-local-object-signing"
	}
	return LocalStore{root: root, bucket: bucket, signingKey: []byte(signingSecret)}, nil
}

func (s LocalStore) Put(ctx context.Context, object Object, body io.Reader) (Object, error) {
	if err := ctx.Err(); err != nil {
		return Object{}, err
	}
	if strings.TrimSpace(object.TenantID) == "" {
		return Object{}, errors.New("tenant_id is required")
	}
	key, err := tenantKey(object.TenantID, object.Key)
	if err != nil {
		return Object{}, err
	}
	if object.Bucket == "" {
		object.Bucket = s.bucket
	}
	if object.Metadata == nil {
		object.Metadata = map[string]any{}
	}
	now := s.clock()
	if object.CreatedAt.IsZero() {
		object.CreatedAt = now
	}
	object.Key = key

	path := s.pathForKey(key)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return Object{}, err
	}
	tmp := path + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return Object{}, err
	}
	hash := sha256.New()
	size, copyErr := io.Copy(out, io.TeeReader(body, hash))
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return Object{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return Object{}, closeErr
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return Object{}, err
	}
	if object.RetentionUntil != nil {
		if err := os.WriteFile(path+".expires", []byte(object.RetentionUntil.UTC().Format(time.RFC3339)), 0o640); err != nil {
			_ = os.Remove(path)
			return Object{}, err
		}
	} else if err := os.Remove(path + ".expires"); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = os.Remove(path)
		return Object{}, err
	}
	object.ByteSize = size
	object.Checksum = "sha256:" + hex.EncodeToString(hash.Sum(nil))
	return object, nil
}

func (s LocalStore) Get(ctx context.Context, tenantID, key string) (Reader, error) {
	if err := ctx.Err(); err != nil {
		return Reader{}, err
	}
	key, err := tenantKey(tenantID, key)
	if err != nil {
		return Reader{}, err
	}
	file, err := os.Open(s.pathForKey(key))
	if errors.Is(err, os.ErrNotExist) {
		return Reader{}, ErrNotFound
	}
	if err != nil {
		return Reader{}, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return Reader{}, err
	}
	return Reader{
		Object: Object{
			TenantID:  tenantID,
			Bucket:    s.bucket,
			Key:       key,
			ByteSize:  info.Size(),
			CreatedAt: info.ModTime().UTC(),
		},
		Body: file,
	}, nil
}

func (s LocalStore) SignGetURL(ctx context.Context, tenantID, key string, ttl time.Duration) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if ttl <= 0 {
		return "", errors.New("signed URL ttl must be positive")
	}
	key, err := tenantKey(tenantID, key)
	if err != nil {
		return "", err
	}
	expires := s.clock().Add(ttl).Unix()
	payload := fmt.Sprintf("%s:%d", key, expires)
	mac := hmac.New(sha256.New, s.signingKey)
	_, _ = mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))
	values := url.Values{}
	values.Set("key", key)
	values.Set("expires", fmt.Sprintf("%d", expires))
	values.Set("sig", sig)
	return "/api/v1/objects/download?" + values.Encode(), nil
}

func (s LocalStore) Delete(ctx context.Context, tenantID, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	key, err := tenantKey(tenantID, key)
	if err != nil {
		return err
	}
	path := s.pathForKey(key)
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Remove(path + ".expires"); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (s LocalStore) CleanupExpired(ctx context.Context, now time.Time) (int, error) {
	deleted := 0
	root := filepath.Join(s.root, s.bucket)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".expires") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		expiry, err := time.Parse(time.RFC3339, strings.TrimSpace(string(data)))
		if err != nil {
			return nil
		}
		if now.Before(expiry) {
			return nil
		}
		objectPath := strings.TrimSuffix(path, ".expires")
		if err := os.Remove(objectPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		deleted++
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	return deleted, err
}

func (s LocalStore) pathForKey(key string) string {
	bucketRoot := filepath.Clean(filepath.Join(s.root, s.bucket))
	path := filepath.Clean(filepath.Join(bucketRoot, filepath.FromSlash(key)))
	rel, err := filepath.Rel(bucketRoot, path)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || rel == ".." || filepath.IsAbs(rel) {
		return filepath.Join(bucketRoot, ".invalid-object-key")
	}
	return path
}

func (s LocalStore) clock() time.Time {
	if s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

func tenantKey(tenantID, key string) (string, error) {
	tenantID, err := normalizeTenantID(tenantID)
	if err != nil {
		return "", err
	}
	key = strings.Trim(strings.TrimSpace(key), "/")
	if key == "" {
		return "", errors.New("object key is required")
	}
	if strings.Contains(key, "\\") || strings.HasPrefix(key, "/") || hasUnsafePathSegment(key) {
		return "", errors.New("object key is invalid")
	}
	prefix := "tenants/" + tenantID + "/"
	if strings.HasPrefix(key, "tenants/") && !strings.HasPrefix(key, prefix) {
		return "", ErrTenantDenied
	}
	if strings.HasPrefix(key, prefix) {
		return key, nil
	}
	return prefix + key, nil
}

func normalizeTenantID(tenantID string) (string, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return "", errors.New("tenant_id is required")
	}
	if strings.ContainsAny(tenantID, `/\`) || tenantID == "." || tenantID == ".." || !tenantIDPattern.MatchString(tenantID) {
		return "", errors.New("tenant_id is invalid")
	}
	return tenantID, nil
}

func hasUnsafePathSegment(key string) bool {
	for _, segment := range strings.Split(key, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return true
		}
	}
	return false
}
