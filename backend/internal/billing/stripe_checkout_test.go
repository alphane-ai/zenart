package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const stripePushProtectionFixtureKey = "sk_test_" + "abcdefghijklmnopqrstuvwxyz123456"

func TestStripeCreateCheckoutPostsSessionRequest(t *testing.T) {
	var gotPath string
	var gotHeader http.Header
	var gotForm url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("ParseForm() error = %v", err)
		}
		gotPath = r.URL.Path
		gotHeader = r.Header.Clone()
		gotForm = r.PostForm
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":       "cs_test_checkout_001",
			"url":      "https://checkout.stripe.test/session/cs_test_checkout_001",
			"livemode": false,
		})
	}))
	defer server.Close()

	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			APIBaseURL: server.URL,
			SecretKey:  "sk_test_local_checkout_key",
			PriceID:    "price_stage1",
			SuccessURL: "http://localhost:26080/billing?stripe=success",
			CancelURL:  "http://localhost:26080/billing?stripe=cancel",
			Mode:       "test",
		},
		HTTPClient: server.Client(),
		Now: func() time.Time {
			return time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
		},
	}

	session, err := adapter.CreateCheckout(context.Background(), "tenant_1", "user_1", "plan_pro")
	if err != nil {
		t.Fatalf("CreateCheckout() error = %v", err)
	}

	if session.ID != "cs_test_checkout_001" || session.Provider != "stripe" || session.TenantID != "tenant_1" || session.UserID != "user_1" {
		t.Fatalf("checkout session = %+v", session)
	}
	if gotPath != "/v1/checkout/sessions" {
		t.Fatalf("path = %q, want /v1/checkout/sessions", gotPath)
	}
	if gotHeader.Get("Authorization") != "Bearer sk_test_local_checkout_key" {
		t.Fatalf("Authorization = %q", gotHeader.Get("Authorization"))
	}
	if gotHeader.Get("Stripe-Version") != stripeAPIVersion {
		t.Fatalf("Stripe-Version = %q, want %q", gotHeader.Get("Stripe-Version"), stripeAPIVersion)
	}
	expectedIdempotencyKey := checkoutIdempotencyKey(
		"tenant_1",
		"user_1",
		"plan_pro",
		"price_stage1",
		"http://localhost:26080/billing?stripe=success",
		"http://localhost:26080/billing?stripe=cancel",
	)
	if gotHeader.Get("Idempotency-Key") != expectedIdempotencyKey {
		t.Fatalf("Idempotency-Key = %q", gotHeader.Get("Idempotency-Key"))
	}

	expectedForm := map[string]string{
		"mode":                                   "subscription",
		"line_items[0][price]":                   "price_stage1",
		"line_items[0][quantity]":                "1",
		"success_url":                            "http://localhost:26080/billing?stripe=success",
		"cancel_url":                             "http://localhost:26080/billing?stripe=cancel",
		"client_reference_id":                    "tenant_1:user_1:plan_pro",
		"metadata[tenant_id]":                    "tenant_1",
		"metadata[user_id]":                      "user_1",
		"metadata[plan_id]":                      "plan_pro",
		"subscription_data[metadata][tenant_id]": "tenant_1",
		"subscription_data[metadata][user_id]":   "user_1",
		"subscription_data[metadata][plan_id]":   "plan_pro",
	}
	for key, want := range expectedForm {
		if got := gotForm.Get(key); got != want {
			t.Fatalf("form[%s] = %q, want %q", key, got, want)
		}
	}
}

func TestStripeCheckoutIdempotencyKeyIncludesCheckoutParameters(t *testing.T) {
	first := checkoutIdempotencyKey(
		"tenant_1",
		"user_1",
		"plan_pro",
		"price_stage1",
		"http://localhost:26080/billing?stripe=success",
		"http://localhost:26080/billing?stripe=cancel",
	)
	second := checkoutIdempotencyKey(
		"tenant_1",
		"user_1",
		"plan_pro",
		"price_stage1",
		"http://localhost:3000/billing?stripe=success",
		"http://localhost:3000/billing?stripe=cancel",
	)
	if first == second {
		t.Fatalf("checkout idempotency key did not change when checkout URLs changed: %s", first)
	}
	if !strings.HasPrefix(first, "checkout:tenant_1:user_1:plan_pro:") {
		t.Fatalf("checkout idempotency key prefix = %q", first)
	}
}

func TestStripeCreateCheckoutRejectsLiveModeResponseInTestMode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":       "cs_live_checkout_001",
			"url":      "https://checkout.stripe.test/session/cs_live_checkout_001",
			"livemode": true,
		})
	}))
	defer server.Close()

	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			APIBaseURL: server.URL,
			SecretKey:  "sk_test_local_checkout_key",
			PriceID:    "price_stage1",
			SuccessURL: "http://localhost:26080/billing?stripe=success",
			CancelURL:  "http://localhost:26080/billing?stripe=cancel",
			Mode:       "test",
		},
		HTTPClient: server.Client(),
	}

	if _, err := adapter.CreateCheckout(context.Background(), "tenant_1", "user_1", "plan_pro"); err == nil {
		t.Fatal("CreateCheckout() error = nil, want livemode rejection")
	}
}

func TestStripeCreateCheckoutRedactsNon2xxResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"type":          "invalid_request_error",
				"code":          "parameter_invalid",
				"decline_code":  "do_not_honor",
				"request_id":    "req_checkout_123",
				"message":       "card failed with client_secret=cs_test_secret_abcdefghijklmnopqrstuvwxyz and payment_method=pm_card_visa",
				"client_secret": "cs_test_secret_abcdefghijklmnopqrstuvwxyz",
			},
		})
	}))
	defer server.Close()

	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			APIBaseURL: server.URL,
			SecretKey:  "sk_test_local_checkout_key",
			PriceID:    "price_stage1",
			SuccessURL: "http://localhost:26080/billing?stripe=success",
			CancelURL:  "http://localhost:26080/billing?stripe=cancel",
			Mode:       "test",
		},
		HTTPClient: server.Client(),
	}

	_, err := adapter.CreateCheckout(context.Background(), "tenant_1", "user_1", "plan_pro")
	if err == nil {
		t.Fatal("CreateCheckout() error = nil, want sanitized Stripe failure")
	}
	message := err.Error()
	for _, leaked := range []string{
		"cs_test_secret_abcdefghijklmnopqrstuvwxyz",
		"payment_method=pm_card_visa",
		"client_secret\":\"",
	} {
		if strings.Contains(message, leaked) {
			t.Fatalf("error leaked %q: %s", leaked, message)
		}
	}
	for _, want := range []string{
		"stripe checkout session create failed",
		"status=400",
		"body_sha256=",
		"type=invalid_request_error",
		"code=parameter_invalid",
		"decline_code=do_not_honor",
		"request_id=req_checkout_123",
		"[REDACTED]",
	} {
		if !strings.Contains(message, want) {
			t.Fatalf("error = %q, want fragment %q", message, want)
		}
	}
}

func TestStripeListInvoicesMapsInvoiceAndReceiptURLs(t *testing.T) {
	var gotPath string
	var gotQuery url.Values
	var gotHeader http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.Query()
		gotHeader = r.Header.Clone()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{
					"id":                 "in_test_001",
					"status":             "paid",
					"currency":           "usd",
					"amount_due":         2900,
					"amount_paid":        2900,
					"hosted_invoice_url": "https://invoice.stripe.test/in_test_001",
					"invoice_pdf":        "https://invoice.stripe.test/in_test_001.pdf",
					"created":            1782036000,
					"livemode":           false,
				},
			},
		})
	}))
	defer server.Close()

	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			APIBaseURL: server.URL,
			SecretKey:  "sk_test_local_checkout_key",
			PriceID:    "price_stage1",
			SuccessURL: "http://localhost:26080/billing?stripe=success",
			CancelURL:  "http://localhost:26080/billing?stripe=cancel",
			Mode:       "test",
		},
		HTTPClient: server.Client(),
		Now: func() time.Time {
			return time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
		},
	}

	page, err := adapter.ListInvoices(context.Background(), "sub_test_001")
	if err != nil {
		t.Fatalf("ListInvoices() error = %v", err)
	}

	if gotPath != "/v1/invoices" {
		t.Fatalf("path = %q, want /v1/invoices", gotPath)
	}
	if gotQuery.Get("subscription") != "sub_test_001" || gotQuery.Get("limit") != "10" {
		t.Fatalf("query = %v", gotQuery)
	}
	if gotHeader.Get("Authorization") != "Bearer sk_test_local_checkout_key" {
		t.Fatalf("Authorization = %q", gotHeader.Get("Authorization"))
	}
	if gotHeader.Get("Stripe-Version") != stripeAPIVersion {
		t.Fatalf("Stripe-Version = %q, want %q", gotHeader.Get("Stripe-Version"), stripeAPIVersion)
	}
	if len(page.Items) != 1 {
		t.Fatalf("invoice count = %d, want 1", len(page.Items))
	}
	invoice := page.Items[0]
	if invoice.ID != "in_test_001" ||
		invoice.Provider != "stripe" ||
		invoice.Status != "paid" ||
		invoice.Currency != "USD" ||
		invoice.AmountDueCents != 2900 ||
		invoice.AmountPaidCents != 2900 ||
		invoice.InvoiceURL != "https://invoice.stripe.test/in_test_001" ||
		invoice.ReceiptURL != "https://invoice.stripe.test/in_test_001.pdf" {
		t.Fatalf("invoice = %#v", invoice)
	}
	if !invoice.CreatedAt.Equal(time.Unix(1782036000, 0).UTC()) {
		t.Fatalf("CreatedAt = %s", invoice.CreatedAt)
	}
}

func TestStripeListInvoicesRejectsLiveModeResponseInTestMode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{
					"id":       "in_live_001",
					"status":   "paid",
					"currency": "usd",
					"livemode": true,
				},
			},
		})
	}))
	defer server.Close()

	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			APIBaseURL: server.URL,
			SecretKey:  "sk_test_local_checkout_key",
			PriceID:    "price_stage1",
			SuccessURL: "http://localhost:26080/billing?stripe=success",
			CancelURL:  "http://localhost:26080/billing?stripe=cancel",
			Mode:       "test",
		},
		HTTPClient: server.Client(),
	}

	if _, err := adapter.ListInvoices(context.Background(), "sub_live_001"); err == nil {
		t.Fatal("ListInvoices() error = nil, want livemode rejection")
	}
}

func TestStripeSharedRequestHelperRedactsNon2xxResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"type":"authentication_error","code":"api_key_invalid","request_id":"req_portal_123","message":"Authorization failed for Bearer ` + stripePushProtectionFixtureKey + `"}}`))
	}))
	defer server.Close()

	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			APIBaseURL:      server.URL,
			SecretKey:       "sk_test_local_checkout_key",
			PriceID:         "price_stage1",
			SuccessURL:      "http://localhost:26080/billing?stripe=success",
			CancelURL:       "http://localhost:26080/billing?stripe=cancel",
			PortalReturnURL: "http://localhost:26080/billing",
			Mode:            "test",
		},
		HTTPClient: server.Client(),
	}

	_, err := adapter.CreatePortalSession(context.Background(), "tenant_1", "user_1", "cus_test_001", "")
	if err == nil {
		t.Fatal("CreatePortalSession() error = nil, want sanitized Stripe failure")
	}
	message := err.Error()
	if strings.Contains(message, stripePushProtectionFixtureKey) || strings.Contains(message, "Bearer sk_test_") {
		t.Fatalf("error leaked Stripe key: %s", message)
	}
	for _, want := range []string{
		"stripe request failed",
		"status=401",
		"body_sha256=",
		"type=authentication_error",
		"code=api_key_invalid",
		"request_id=req_portal_123",
		"[REDACTED]",
	} {
		if !strings.Contains(message, want) {
			t.Fatalf("error = %q, want fragment %q", message, want)
		}
	}
}

func TestStripeSyncTeamSeatQuantityUpdatesSubscriptionItem(t *testing.T) {
	var gotPath string
	var gotHeader http.Header
	var gotForm url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("ParseForm() error = %v", err)
		}
		gotPath = r.URL.Path
		gotHeader = r.Header.Clone()
		gotForm = r.PostForm
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":           "si_test_team_seats",
			"subscription": "sub_test_001",
			"quantity":     4,
			"livemode":     false,
			"price": map[string]any{
				"id":       "price_team_seat",
				"livemode": false,
			},
		})
	}))
	defer server.Close()

	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			APIBaseURL: server.URL,
			SecretKey:  "sk_test_local_checkout_key",
			PriceID:    "price_stage1",
			SuccessURL: "http://localhost:26080/billing?stripe=success",
			CancelURL:  "http://localhost:26080/billing?stripe=cancel",
			Mode:       "test",
		},
		HTTPClient: server.Client(),
		Now: func() time.Time {
			return time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
		},
	}

	result, err := adapter.SyncTeamSeatQuantity(context.Background(), TeamSeatProviderRequest{
		TenantID:                   "tenant_1",
		TeamID:                     "team_1",
		Operation:                  "team.invite",
		IdempotencyKey:             "team-invite-1",
		ProviderSubscriptionID:     "sub_test_001",
		ProviderSubscriptionItemID: "si_test_team_seats",
		PriceID:                    "price_team_seat",
		Quantity:                   4,
		ProrationBehavior:          "create_prorations",
	})
	if err != nil {
		t.Fatalf("SyncTeamSeatQuantity() error = %v", err)
	}

	if gotPath != "/v1/subscription_items/si_test_team_seats" {
		t.Fatalf("path = %q, want subscription item update", gotPath)
	}
	if gotHeader.Get("Authorization") != "Bearer sk_test_local_checkout_key" {
		t.Fatalf("Authorization = %q", gotHeader.Get("Authorization"))
	}
	if gotHeader.Get("Stripe-Version") != stripeAPIVersion {
		t.Fatalf("Stripe-Version = %q", gotHeader.Get("Stripe-Version"))
	}
	if gotHeader.Get("Idempotency-Key") != "team-seat:tenant_1:team_1:team.invite:team-invite-1" {
		t.Fatalf("Idempotency-Key = %q", gotHeader.Get("Idempotency-Key"))
	}
	expectedForm := map[string]string{
		"quantity":            "4",
		"proration_behavior":  "create_prorations",
		"price":               "price_team_seat",
		"metadata[tenant_id]": "tenant_1",
		"metadata[team_id]":   "team_1",
		"metadata[operation]": "team.invite",
	}
	for key, want := range expectedForm {
		if got := gotForm.Get(key); got != want {
			t.Fatalf("form[%s] = %q, want %q", key, got, want)
		}
	}
	if result.Provider != "stripe" ||
		result.ProviderSubscriptionID != "sub_test_001" ||
		result.ProviderSubscriptionItemID != "si_test_team_seats" ||
		result.PriceID != "price_team_seat" ||
		result.RequestedQuantity != 4 ||
		result.SyncedQuantity != 4 ||
		result.Status != "synced" {
		t.Fatalf("result = %#v", result)
	}
}
