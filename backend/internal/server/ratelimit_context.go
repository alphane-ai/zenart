package server

import (
	"context"

	"github.com/alphane-ai/zenart/backend/internal/ratelimit"
)

type rateLimiterKey struct{}

func ContextWithRateLimiter(ctx context.Context, enforcer ratelimit.Enforcer) context.Context {
	return context.WithValue(ctx, rateLimiterKey{}, enforcer)
}

func RateLimiterFromContext(ctx context.Context) (ratelimit.Enforcer, bool) {
	enforcer, ok := ctx.Value(rateLimiterKey{}).(ratelimit.Enforcer)
	return enforcer, ok
}
