package objectstore

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
)

type S3Store struct {
	client         *http.Client
	endpoint       *url.URL
	publicEndpoint *url.URL
	bucket         string
	region         string
	accessKey      string
	secretKey      string
	forcePathStyle bool
	now            func() time.Time
}

func NewS3Store(cfg config.ObjectStorageConfig, client *http.Client) (S3Store, error) {
	if client == nil {
		client = http.DefaultClient
	}
	endpoint, err := parseS3Endpoint(cfg.Endpoint, cfg.UseSSL)
	if err != nil {
		return S3Store{}, err
	}
	publicEndpoint := endpoint
	if strings.TrimSpace(cfg.PublicEndpoint) != "" {
		publicEndpoint, err = parseS3Endpoint(cfg.PublicEndpoint, cfg.UseSSL)
		if err != nil {
			return S3Store{}, err
		}
	}
	if strings.TrimSpace(cfg.Bucket) == "" {
		return S3Store{}, errors.New("object store bucket is required")
	}
	if strings.TrimSpace(cfg.Region) == "" {
		return S3Store{}, errors.New("object store region is required")
	}
	if strings.TrimSpace(cfg.AccessKey) == "" || strings.TrimSpace(cfg.SecretKey) == "" {
		return S3Store{}, errors.New("object store S3 credentials are required")
	}
	return S3Store{
		client:         client,
		endpoint:       endpoint,
		publicEndpoint: publicEndpoint,
		bucket:         strings.TrimSpace(cfg.Bucket),
		region:         strings.TrimSpace(cfg.Region),
		accessKey:      strings.TrimSpace(cfg.AccessKey),
		secretKey:      strings.TrimSpace(cfg.SecretKey),
		forcePathStyle: cfg.ForcePathStyle,
	}, nil
}

func (s S3Store) Put(ctx context.Context, object Object, body io.Reader) (Object, error) {
	if err := ctx.Err(); err != nil {
		return Object{}, err
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
	if object.CreatedAt.IsZero() {
		object.CreatedAt = s.clock()
	}
	payload, err := io.ReadAll(body)
	if err != nil {
		return Object{}, err
	}
	sum := sha256.Sum256(payload)
	object.Key = key
	object.ByteSize = int64(len(payload))
	object.Checksum = "sha256:" + hex.EncodeToString(sum[:])

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.objectURL(s.endpoint, key).String(), bytes.NewReader(payload))
	if err != nil {
		return Object{}, err
	}
	req.Header.Set("Content-Type", object.ContentType)
	req.Header.Set("X-Amz-Content-Sha256", hex.EncodeToString(sum[:]))
	s.sign(req, hex.EncodeToString(sum[:]), s.clock())

	resp, err := s.client.Do(req)
	if err != nil {
		return Object{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Object{}, fmt.Errorf("s3 put object status %d", resp.StatusCode)
	}
	return object, nil
}

func (s S3Store) Get(ctx context.Context, tenantID, key string) (Reader, error) {
	if err := ctx.Err(); err != nil {
		return Reader{}, err
	}
	key, err := tenantKey(tenantID, key)
	if err != nil {
		return Reader{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.objectURL(s.endpoint, key).String(), nil)
	if err != nil {
		return Reader{}, err
	}
	emptyHash := hashHex(nil)
	req.Header.Set("X-Amz-Content-Sha256", emptyHash)
	s.sign(req, emptyHash, s.clock())

	resp, err := s.client.Do(req)
	if err != nil {
		return Reader{}, err
	}
	if resp.StatusCode == http.StatusNotFound {
		_ = resp.Body.Close()
		return Reader{}, ErrNotFound
	}
	if resp.StatusCode == http.StatusForbidden {
		_ = resp.Body.Close()
		return Reader{}, ErrTenantDenied
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		_ = resp.Body.Close()
		return Reader{}, fmt.Errorf("s3 get object status %d", resp.StatusCode)
	}
	return Reader{
		Object: Object{
			TenantID:    tenantID,
			Bucket:      s.bucket,
			Key:         key,
			ContentType: resp.Header.Get("Content-Type"),
			ByteSize:    resp.ContentLength,
		},
		Body: resp.Body,
	}, nil
}

func (s S3Store) SignGetURL(ctx context.Context, tenantID, key string, ttl time.Duration) (string, error) {
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
	now := s.clock()
	expires := int(ttl.Seconds())
	if expires < 1 {
		expires = 1
	}
	u := s.objectURL(s.publicEndpoint, key)
	query := u.Query()
	query.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	query.Set("X-Amz-Credential", s.accessKey+"/"+s.credentialScope(now))
	query.Set("X-Amz-Date", now.UTC().Format("20060102T150405Z"))
	query.Set("X-Amz-Expires", fmt.Sprintf("%d", expires))
	query.Set("X-Amz-SignedHeaders", "host")
	u.RawQuery = query.Encode()
	canonicalRequest := strings.Join([]string{
		http.MethodGet,
		canonicalURI(u.EscapedPath()),
		canonicalQuery(u.Query()),
		"host:" + u.Host + "\n",
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		now.UTC().Format("20060102T150405Z"),
		s.credentialScope(now),
		hashHex([]byte(canonicalRequest)),
	}, "\n")
	signature := hex.EncodeToString(hmacSHA256(s.signingKey(now), stringToSign))
	query = u.Query()
	query.Set("X-Amz-Signature", signature)
	u.RawQuery = query.Encode()
	return u.String(), nil
}

func (s S3Store) Delete(ctx context.Context, tenantID, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	key, err := tenantKey(tenantID, key)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, s.objectURL(s.endpoint, key).String(), nil)
	if err != nil {
		return err
	}
	emptyHash := hashHex(nil)
	req.Header.Set("X-Amz-Content-Sha256", emptyHash)
	s.sign(req, emptyHash, s.clock())

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode == http.StatusForbidden {
		return ErrTenantDenied
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("s3 delete object status %d", resp.StatusCode)
	}
	return nil
}

func (s S3Store) CleanupExpired(ctx context.Context, now time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	return 0, nil
}

func (s S3Store) objectURL(base *url.URL, key string) *url.URL {
	u := *base
	cleanKey := path.Clean("/" + key)
	if s.forcePathStyle {
		u.Path = strings.TrimRight(u.Path, "/") + "/" + s.bucket + cleanKey
		return &u
	}
	u.Host = s.bucket + "." + u.Host
	u.Path = strings.TrimRight(u.Path, "/") + cleanKey
	return &u
}

func (s S3Store) sign(req *http.Request, payloadHash string, now time.Time) {
	req.Header.Set("Host", req.URL.Host)
	req.Header.Set("X-Amz-Date", now.UTC().Format("20060102T150405Z"))
	if req.Header.Get("X-Amz-Content-Sha256") == "" {
		req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	}
	signedHeaders := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	canonicalRequest := strings.Join([]string{
		req.Method,
		canonicalURI(req.URL.EscapedPath()),
		canonicalQuery(req.URL.Query()),
		"host:" + req.URL.Host + "\n" +
			"x-amz-content-sha256:" + req.Header.Get("X-Amz-Content-Sha256") + "\n" +
			"x-amz-date:" + req.Header.Get("X-Amz-Date") + "\n",
		strings.Join(signedHeaders, ";"),
		payloadHash,
	}, "\n")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		req.Header.Get("X-Amz-Date"),
		s.credentialScope(now),
		hashHex([]byte(canonicalRequest)),
	}, "\n")
	signature := hex.EncodeToString(hmacSHA256(s.signingKey(now), stringToSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+s.accessKey+"/"+s.credentialScope(now)+", SignedHeaders="+strings.Join(signedHeaders, ";")+", Signature="+signature)
}

func (s S3Store) credentialScope(now time.Time) string {
	return now.UTC().Format("20060102") + "/" + s.region + "/s3/aws4_request"
}

func (s S3Store) signingKey(now time.Time) []byte {
	dateKey := hmacSHA256([]byte("AWS4"+s.secretKey), now.UTC().Format("20060102"))
	regionKey := hmacSHA256(dateKey, s.region)
	serviceKey := hmacSHA256(regionKey, "s3")
	return hmacSHA256(serviceKey, "aws4_request")
}

func (s S3Store) clock() time.Time {
	if s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

func parseS3Endpoint(raw string, useSSL bool) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("object store endpoint is required")
	}
	if !strings.Contains(raw, "://") {
		if useSSL {
			raw = "https://" + raw
		} else {
			raw = "http://" + raw
		}
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("object store endpoint must include scheme and host")
	}
	return parsed, nil
}

func canonicalURI(value string) string {
	if value == "" {
		return "/"
	}
	return value
}

func canonicalQuery(values url.Values) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		vals := values[key]
		sort.Strings(vals)
		for _, value := range vals {
			parts = append(parts, url.QueryEscape(key)+"="+url.QueryEscape(value))
		}
	}
	return strings.Join(parts, "&")
}

func hashHex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(data))
	return mac.Sum(nil)
}
