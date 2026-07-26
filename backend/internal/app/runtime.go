package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/audit"
	"github.com/alphane-ai/zenart/backend/internal/billing"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/provider"
	"github.com/alphane-ai/zenart/backend/internal/ratelimit"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/server"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
	"github.com/alphane-ai/zenart/backend/internal/team"
	"github.com/redis/go-redis/v9"
)

func Logger() *slog.Logger {
	return slog.New(security.NewRedactingSlogHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{})))
}

func RunServer(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	pool, err := store.OpenPool(ctx, cfg.Postgres.DSN)
	if err != nil {
		return err
	}
	defer pool.Close()

	objects, err := objectstore.NewStore(cfg.ObjectStorage, http.DefaultClient)
	if err != nil {
		return err
	}
	db := store.NewPoolAdapter(pool)
	scanner := malwareScannerFromConfig(cfg, http.DefaultClient)
	rateLimiter, closeRateLimiter := rateLimiterFromConfig(cfg)
	defer closeRateLimiter()
	api := server.New(cfg, logger, server.WithMalwareScanner(scanner), server.WithRateLimiter(rateLimiter))
	stage0Service := stage0.NewService(stage0.NewRepository(db), objects, scanner).
		WithDownloadURLTTL(cfg.ObjectStorage.DownloadURLTTL).
		WithDownloadURLSigner(api.SignDownloadURL)
	baseHandler := api.Handler()
	auditStore := audit.NewPostgresRecorder(db)
	billingProvider := billingProviderFromConfig(cfg, db, http.DefaultClient)
	teamService := team.NewRepository(db)
	teamSeatBilling := billing.NewTeamSeatBillingRepository(db, billingProvider)
	providerRegistry := provider.NewRegistryRepository(db)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqCtx := task.ContextWithRepository(r.Context(), task.NewRepository(db))
		reqCtx = task.ContextWithBatchStore(reqCtx, task.NewBatchRepository(db).WithQuotaLedger(task.NewPostgresBatchQuotaLedger(db)).WithStrategyGroupReader(providerRegistry))
		reqCtx = stage0.ContextWithService(reqCtx, stage0Service)
		reqCtx = audit.ContextWithSearcher(reqCtx, auditStore)
		reqCtx = audit.ContextWithRecorder(reqCtx, auditStore)
		reqCtx = server.ContextWithBillingProvider(reqCtx, billingProvider)
		reqCtx = server.ContextWithBillingAccountReader(reqCtx, billing.NewAccountRepository(db))
		reqCtx = server.ContextWithBillingAdminOperator(reqCtx, billing.NewAdminBillingRepository(db))
		reqCtx = server.ContextWithTeamService(reqCtx, teamService)
		reqCtx = server.ContextWithTeamSeatBillingManager(reqCtx, teamSeatBilling)
		reqCtx = server.ContextWithRateLimiter(reqCtx, rateLimiter)
		reqCtx = provider.ContextWithRegistryReader(reqCtx, providerRegistry)
		reqCtx = provider.ContextWithClientResolver(reqCtx, providerClientsFromConfig(cfg, http.DefaultClient))
		baseHandler.ServeHTTP(w, r.WithContext(reqCtx))
	})
	srv := server.NewHTTPServer(cfg, handler)
	errCh := make(chan error, 1)
	metricsSrv := StartMetricsServer(ctx, cfg, logger, api.MetricsHandler())

	go func() {
		logger.Info("server listening", "addr", cfg.HTTP.Addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if metricsSrv != nil {
			_ = metricsSrv.Shutdown(shutdownCtx)
		}
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
		return ctx.Err()
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func rateLimiterFromConfig(cfg config.Config) (ratelimit.Enforcer, func() error) {
	policy := ratelimit.Policy{
		Enabled:                     cfg.RateLimit.Enabled,
		UserRequestsPerMinute:       int64(cfg.RateLimit.UserRequestsPerMinute),
		TenantRequestsPerMinute:     int64(cfg.RateLimit.TenantRequestsPerMinute),
		ProviderRequestsPerMinute:   int64(cfg.RateLimit.ProviderRequestsPerMinute),
		AdminActionsPerMinute:       int64(cfg.RateLimit.AdminActionsPerMinute),
		ProviderDailySpendCapCents:  cfg.RateLimit.ProviderDailySpendCapCents,
		ProviderEmergencyKillSwitch: cfg.RateLimit.ProviderEmergencyKillSwitch,
	}
	if strings.EqualFold(strings.TrimSpace(cfg.RateLimit.Store), "redis") {
		client := redis.NewClient(&redis.Options{
			Addr:     cfg.Redis.Addr,
			Password: cfg.Redis.Password,
			DB:       cfg.Redis.DB,
		})
		return ratelimit.NewEnforcer(ratelimit.RedisStore{Client: client, KeyPrefix: "zenari:stage1:ratelimit"}, policy), client.Close
	}
	return ratelimit.NewEnforcer(ratelimit.NewMemoryStore(), policy), func() error { return nil }
}

func billingProviderFromConfig(cfg config.Config, db store.DBTX, client *http.Client) billing.PaidProviderAdapter {
	if strings.EqualFold(strings.TrimSpace(cfg.Billing.CheckoutProvider), "stripe") {
		secretKey := strings.TrimSpace(cfg.Billing.StripeSecretKey)
		if secretKey == "" {
			secretKey = strings.TrimSpace(cfg.Billing.StripeAPIKey)
		}
		return billing.StripeAdapter{
			Config: billing.StripeCheckoutConfig{
				APIBaseURL:      cfg.Billing.StripeAPIBaseURL,
				SecretKey:       secretKey,
				WebhookSecret:   cfg.Billing.StripeWebhookSecret,
				PublishableKey:  cfg.Billing.StripePublishableKey,
				PriceID:         cfg.Billing.StripeDefaultPriceID,
				SuccessURL:      cfg.Billing.StripeSuccessURL,
				CancelURL:       cfg.Billing.StripeCancelURL,
				PortalReturnURL: cfg.Billing.StripePortalReturnURL,
				Mode:            cfg.Billing.StripeMode,
			},
			HTTPClient: client,
			Events:     billing.NewStripeEventRepository(db),
		}
	}
	return billing.MockPaidProviderAdapter{Checkout: billing.MockCheckoutProvider{}}
}

func providerClientsFromConfig(cfg config.Config, client *http.Client) provider.ClientMap {
	devProvider := provider.DevProvider{}
	clients := provider.ClientMap{
		"dev":                  devProvider,
		"zenari-image-sandbox": devProvider,
	}
	if cfg.LLM.EnableLiveCalls && strings.EqualFold(strings.TrimSpace(cfg.LLM.Provider), "openai-compatible") {
		clients["zenari-image-sandbox"] = provider.OpenAICompatibleProvider{Config: provider.OpenAICompatibleConfig{
			ProviderID:       "zenari-image-sandbox",
			BaseURL:          cfg.LLM.OpenAIBaseURL,
			APIKey:           cfg.LLM.OpenAIAPIKey,
			ModelID:          cfg.LLM.OpenAIModel,
			Timeout:          cfg.LLM.RequestTimeout,
			LiveCallsEnabled: true,
			HTTPClient:       client,
		}}
	}
	return clients
}

func malwareScannerFromConfig(cfg config.Config, client *http.Client) security.MalwareScanner {
	provider := strings.ToLower(strings.TrimSpace(cfg.Security.MalwareScanProvider))
	switch provider {
	case "http":
		return security.HTTPMalwareScanner{
			Endpoint:           cfg.Security.MalwareScanEndpoint,
			APIKey:             cfg.Security.MalwareScanAPIKey,
			Provider:           "http",
			Client:             client,
			Timeout:            cfg.Security.MalwareScanTimeout,
			DenyLocalEndpoints: !isLocalEnvironment(cfg.App.Environment),
		}
	default:
		return security.PlaceholderMalwareScanner{Provider: provider}
	}
}

func isLocalEnvironment(environment string) bool {
	return strings.EqualFold(strings.TrimSpace(environment), "") || strings.EqualFold(strings.TrimSpace(environment), "local")
}

func SignalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
}
