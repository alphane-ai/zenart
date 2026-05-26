package objectstore

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

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
	endpoint, err := url.Parse(p.cfg.Endpoint)
	if err != nil {
		return err
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/" + p.cfg.Bucket

	req, err := http.NewRequestWithContext(ctx, http.MethodHead, endpoint.String(), nil)
	if err != nil {
		return err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK, http.StatusForbidden, http.StatusUnauthorized:
		return nil
	case http.StatusNotFound:
		return fmt.Errorf("bucket %q not found", p.cfg.Bucket)
	default:
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
}
