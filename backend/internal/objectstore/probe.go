package objectstore

import (
	"context"
	"fmt"
	"net/http"

	"github.com/alphane-ai/zenart/backend/internal/config"
)

type HTTPProbe struct {
	client *http.Client
	cfg    config.ObjectStorageConfig
}

func NewHTTPProbe(client *http.Client, cfg config.ObjectStorageConfig) HTTPProbe {
	if client == nil {
		client = http.DefaultClient
	}
	return HTTPProbe{client: client, cfg: cfg}
}

func (p HTTPProbe) Check(ctx context.Context) error {
	switch p.cfg.Provider {
	case "s3-compatible":
		return p.checkS3Compatible(ctx)
	default:
		return fmt.Errorf("unsupported object storage probe provider %q", p.cfg.Provider)
	}
}

func (p HTTPProbe) checkS3Compatible(ctx context.Context) error {
	store, err := NewS3Store(p.cfg, p.client)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, store.bucketURL(store.endpoint).String(), nil)
	if err != nil {
		return err
	}
	emptyHash := hashHex(nil)
	req.Header.Set("X-Amz-Content-Sha256", emptyHash)
	store.sign(req, emptyHash, store.clock())

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		return nil
	case http.StatusNotFound:
		return fmt.Errorf("bucket %q not found", p.cfg.Bucket)
	case http.StatusForbidden, http.StatusUnauthorized:
		return fmt.Errorf("S3-compatible object storage credentials rejected with status %d", resp.StatusCode)
	default:
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
}
