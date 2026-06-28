package billing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

const stripeAPIVersion = "2024-06-20"

var stripeErrorObjectIDPattern = regexp.MustCompile(`\b(?:pm|pi|seti|cs|cus|sub|si|in|ch|re|src|tok)_[A-Za-z0-9_]{6,}\b`)

type StripeCheckoutConfig struct {
	APIBaseURL      string
	SecretKey       string
	WebhookSecret   string
	PublishableKey  string
	PriceID         string
	SuccessURL      string
	CancelURL       string
	PortalReturnURL string
	Mode            string
}

type StripeAdapter struct {
	Config     StripeCheckoutConfig
	HTTPClient *http.Client
	Events     StripeEventStore
	Now        func() time.Time
}

func (a StripeAdapter) CreateCheckout(ctx context.Context, tenantID, userID, planID string) (CheckoutSession, error) {
	if tenantID == "" || userID == "" || planID == "" {
		return CheckoutSession{}, errors.New("tenant_id, user_id, and plan_id are required")
	}
	if err := a.Config.validate(); err != nil {
		return CheckoutSession{}, err
	}
	mode := strings.TrimSpace(a.Config.Mode)
	if mode == "" {
		mode = "test"
	}

	form := url.Values{}
	form.Set("mode", "subscription")
	form.Set("line_items[0][price]", a.Config.PriceID)
	form.Set("line_items[0][quantity]", "1")
	form.Set("success_url", a.Config.SuccessURL)
	form.Set("cancel_url", a.Config.CancelURL)
	form.Set("client_reference_id", tenantID+":"+userID+":"+planID)
	form.Set("metadata[tenant_id]", tenantID)
	form.Set("metadata[user_id]", userID)
	form.Set("metadata[plan_id]", planID)
	form.Set("subscription_data[metadata][tenant_id]", tenantID)
	form.Set("subscription_data[metadata][user_id]", userID)
	form.Set("subscription_data[metadata][plan_id]", planID)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.Config.APIBaseURL, "/")+"/v1/checkout/sessions", strings.NewReader(form.Encode()))
	if err != nil {
		return CheckoutSession{}, err
	}
	req.Header.Set("Authorization", "Bearer "+a.Config.SecretKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Stripe-Version", stripeAPIVersion)
	req.Header.Set("Idempotency-Key", checkoutIdempotencyKey(tenantID, userID, planID, a.Config.PriceID, a.Config.SuccessURL, a.Config.CancelURL))

	resp, err := a.client().Do(req)
	if err != nil {
		return CheckoutSession{}, err
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return CheckoutSession{}, readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return CheckoutSession{}, fmt.Errorf("stripe checkout session create failed: %s", stripeErrorSummary(resp.StatusCode, body))
	}

	var decoded struct {
		ID       string `json:"id"`
		URL      string `json:"url"`
		Livemode bool   `json:"livemode"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return CheckoutSession{}, err
	}
	if decoded.ID == "" || decoded.URL == "" {
		return CheckoutSession{}, errors.New("stripe checkout response missing id or url")
	}
	if mode == "test" && decoded.Livemode {
		return CheckoutSession{}, errors.New("stripe checkout response livemode=true while STRIPE_MODE=test")
	}

	return CheckoutSession{
		ID:          decoded.ID,
		TenantID:    tenantID,
		UserID:      userID,
		Provider:    "stripe",
		RedirectURL: decoded.URL,
		CreatedAt:   a.now(),
	}, nil
}

func (a StripeAdapter) CreatePortalSession(ctx context.Context, tenantID, userID, customerID, returnURL string) (BillingPortalSession, error) {
	if tenantID == "" || userID == "" || customerID == "" {
		return BillingPortalSession{}, errors.New("tenant_id, user_id, and customer_id are required")
	}
	if err := a.Config.validate(); err != nil {
		return BillingPortalSession{}, err
	}
	if strings.TrimSpace(returnURL) == "" {
		returnURL = a.Config.PortalReturnURL
	}
	if strings.TrimSpace(returnURL) == "" {
		return BillingPortalSession{}, errors.New("stripe portal return url is required")
	}

	form := url.Values{}
	form.Set("customer", customerID)
	form.Set("return_url", returnURL)

	body, err := a.postStripeForm(ctx, "/v1/billing_portal/sessions", form, portalIdempotencyKey(tenantID, userID, customerID))
	if err != nil {
		return BillingPortalSession{}, err
	}
	var decoded struct {
		ID       string `json:"id"`
		URL      string `json:"url"`
		Livemode bool   `json:"livemode"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return BillingPortalSession{}, err
	}
	if decoded.ID == "" || decoded.URL == "" {
		return BillingPortalSession{}, errors.New("stripe portal response missing id or url")
	}
	if a.testMode() && decoded.Livemode {
		return BillingPortalSession{}, errors.New("stripe portal response livemode=true while STRIPE_MODE=test")
	}
	return BillingPortalSession{
		ID:          decoded.ID,
		TenantID:    tenantID,
		UserID:      userID,
		Provider:    "stripe",
		RedirectURL: decoded.URL,
		CreatedAt:   a.now(),
	}, nil
}

func (a StripeAdapter) CancelSubscription(ctx context.Context, subscriptionID string) (SubscriptionCancellation, error) {
	subscriptionID = strings.TrimSpace(subscriptionID)
	if subscriptionID == "" {
		return SubscriptionCancellation{}, errors.New("subscription id is required")
	}
	if err := a.Config.validate(); err != nil {
		return SubscriptionCancellation{}, err
	}

	form := url.Values{}
	form.Set("cancel_at_period_end", "true")
	body, err := a.postStripeForm(ctx, "/v1/subscriptions/"+url.PathEscape(subscriptionID), form, "cancel:"+subscriptionID)
	if err != nil {
		return SubscriptionCancellation{}, err
	}
	var decoded struct {
		ID                string `json:"id"`
		Status            string `json:"status"`
		CancelAtPeriodEnd bool   `json:"cancel_at_period_end"`
		CurrentPeriodEnd  int64  `json:"current_period_end"`
		Livemode          bool   `json:"livemode"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return SubscriptionCancellation{}, err
	}
	if decoded.ID == "" {
		return SubscriptionCancellation{}, errors.New("stripe subscription cancel response missing id")
	}
	if a.testMode() && decoded.Livemode {
		return SubscriptionCancellation{}, errors.New("stripe subscription response livemode=true while STRIPE_MODE=test")
	}
	var periodEnd *time.Time
	if decoded.CurrentPeriodEnd > 0 {
		value := time.Unix(decoded.CurrentPeriodEnd, 0).UTC()
		periodEnd = &value
	}
	return SubscriptionCancellation{
		ID:                decoded.ID,
		Provider:          "stripe",
		Status:            mapStripeSubscriptionStatus(decoded.Status),
		CancelAtPeriodEnd: decoded.CancelAtPeriodEnd,
		CurrentPeriodEnd:  periodEnd,
		UpdatedAt:         a.now(),
	}, nil
}

func (a StripeAdapter) ListInvoices(ctx context.Context, subscriptionID string) (BillingInvoicePage, error) {
	subscriptionID = strings.TrimSpace(subscriptionID)
	if subscriptionID == "" {
		return BillingInvoicePage{}, errors.New("subscription id is required")
	}
	if err := a.Config.validate(); err != nil {
		return BillingInvoicePage{}, err
	}
	endpoint := "/v1/invoices?subscription=" + url.QueryEscape(subscriptionID) + "&limit=10"
	body, err := a.getStripe(ctx, endpoint)
	if err != nil {
		return BillingInvoicePage{}, err
	}
	var decoded struct {
		Data []struct {
			ID               string `json:"id"`
			Status           string `json:"status"`
			Currency         string `json:"currency"`
			AmountDue        int64  `json:"amount_due"`
			AmountPaid       int64  `json:"amount_paid"`
			HostedInvoiceURL string `json:"hosted_invoice_url"`
			InvoicePDF       string `json:"invoice_pdf"`
			Created          int64  `json:"created"`
			Livemode         bool   `json:"livemode"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return BillingInvoicePage{}, err
	}
	page := BillingInvoicePage{Items: []BillingInvoice{}}
	for _, invoice := range decoded.Data {
		if invoice.ID == "" {
			continue
		}
		if a.testMode() && invoice.Livemode {
			return BillingInvoicePage{}, errors.New("stripe invoice response livemode=true while STRIPE_MODE=test")
		}
		createdAt := a.now()
		if invoice.Created > 0 {
			createdAt = time.Unix(invoice.Created, 0).UTC()
		}
		page.Items = append(page.Items, BillingInvoice{
			ID:              invoice.ID,
			Provider:        "stripe",
			Status:          invoice.Status,
			Currency:        strings.ToUpper(invoice.Currency),
			AmountDueCents:  invoice.AmountDue,
			AmountPaidCents: invoice.AmountPaid,
			InvoiceURL:      invoice.HostedInvoiceURL,
			ReceiptURL:      invoice.InvoicePDF,
			CreatedAt:       createdAt,
		})
	}
	return page, nil
}

func (a StripeAdapter) SyncTeamSeatQuantity(ctx context.Context, request TeamSeatProviderRequest) (TeamSeatSyncResult, error) {
	if request.TenantID == "" || request.TeamID == "" || request.IdempotencyKey == "" || request.Quantity <= 0 {
		return TeamSeatSyncResult{}, ErrTeamSeatBillingValidation
	}
	itemID := strings.TrimSpace(request.ProviderSubscriptionItemID)
	if itemID == "" {
		return TeamSeatSyncResult{}, errors.New("stripe subscription item id is required for team seat sync")
	}
	if err := a.Config.validate(); err != nil {
		return TeamSeatSyncResult{}, err
	}
	prorationBehavior := strings.TrimSpace(request.ProrationBehavior)
	if prorationBehavior == "" {
		prorationBehavior = "create_prorations"
	}

	form := url.Values{}
	form.Set("quantity", fmt.Sprintf("%d", request.Quantity))
	form.Set("proration_behavior", prorationBehavior)
	form.Set("metadata[tenant_id]", request.TenantID)
	form.Set("metadata[team_id]", request.TeamID)
	form.Set("metadata[operation]", request.Operation)
	if strings.TrimSpace(request.PriceID) != "" {
		form.Set("price", strings.TrimSpace(request.PriceID))
	}

	body, err := a.postStripeForm(ctx, "/v1/subscription_items/"+url.PathEscape(itemID), form, teamSeatStripeIdempotencyKey(request))
	if err != nil {
		return TeamSeatSyncResult{}, err
	}
	var decoded struct {
		ID           string `json:"id"`
		Subscription string `json:"subscription"`
		Quantity     int    `json:"quantity"`
		Livemode     bool   `json:"livemode"`
		Price        struct {
			ID       string `json:"id"`
			Livemode bool   `json:"livemode"`
		} `json:"price"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return TeamSeatSyncResult{}, err
	}
	if decoded.ID == "" {
		return TeamSeatSyncResult{}, errors.New("stripe subscription item response missing id")
	}
	if a.testMode() && (decoded.Livemode || decoded.Price.Livemode) {
		return TeamSeatSyncResult{}, errors.New("stripe team seat response livemode=true while STRIPE_MODE=test")
	}
	syncedQuantity := decoded.Quantity
	if syncedQuantity == 0 {
		syncedQuantity = request.Quantity
	}
	return TeamSeatSyncResult{
		ID:                         teamSeatSyncID(request.TenantID, request.TeamID, request.Operation, request.IdempotencyKey),
		TenantID:                   request.TenantID,
		TeamID:                     request.TeamID,
		Provider:                   "stripe",
		ProviderSubscriptionID:     firstNonEmptyString(decoded.Subscription, request.ProviderSubscriptionID),
		ProviderSubscriptionItemID: decoded.ID,
		PriceID:                    firstNonEmptyString(decoded.Price.ID, request.PriceID),
		RequestedQuantity:          request.Quantity,
		SyncedQuantity:             syncedQuantity,
		ProrationBehavior:          prorationBehavior,
		Status:                     "synced",
		Operation:                  request.Operation,
		IdempotencyKey:             request.IdempotencyKey,
		CreatedAt:                  a.now(),
	}, nil
}

func (c StripeCheckoutConfig) validate() error {
	if strings.TrimSpace(c.APIBaseURL) == "" {
		return errors.New("stripe api base url is required")
	}
	if strings.TrimSpace(c.SecretKey) == "" {
		return errors.New("stripe secret key is required")
	}
	if strings.TrimSpace(c.PriceID) == "" {
		return errors.New("stripe price id is required")
	}
	if strings.TrimSpace(c.SuccessURL) == "" || strings.TrimSpace(c.CancelURL) == "" {
		return errors.New("stripe success and cancel urls are required")
	}
	mode := strings.TrimSpace(c.Mode)
	if mode == "" {
		mode = "test"
	}
	if mode != "test" && mode != "live" {
		return errors.New(`stripe mode must be "test" or "live"`)
	}
	return nil
}

func checkoutIdempotencyKey(tenantID, userID, planID, priceID, successURL, cancelURL string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		strings.TrimSpace(tenantID),
		strings.TrimSpace(userID),
		strings.TrimSpace(planID),
		strings.TrimSpace(priceID),
		strings.TrimSpace(successURL),
		strings.TrimSpace(cancelURL),
	}, "\x00")))
	return "checkout:" + tenantID + ":" + userID + ":" + planID + ":" + hex.EncodeToString(sum[:8])
}

func portalIdempotencyKey(tenantID, userID, customerID string) string {
	return "portal:" + tenantID + ":" + userID + ":" + customerID
}

func teamSeatStripeIdempotencyKey(request TeamSeatProviderRequest) string {
	return "team-seat:" + request.TenantID + ":" + request.TeamID + ":" + request.Operation + ":" + request.IdempotencyKey
}

func (a StripeAdapter) postStripeForm(ctx context.Context, path string, form url.Values, idempotencyKey string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.Config.APIBaseURL, "/")+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+a.Config.SecretKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Stripe-Version", stripeAPIVersion)
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	return a.doStripe(req, "stripe request failed")
}

func (a StripeAdapter) getStripe(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(a.Config.APIBaseURL, "/")+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+a.Config.SecretKey)
	req.Header.Set("Stripe-Version", stripeAPIVersion)
	return a.doStripe(req, "stripe request failed")
}

func (a StripeAdapter) doStripe(req *http.Request, message string) ([]byte, error) {
	resp, err := a.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return nil, readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s: %s", message, stripeErrorSummary(resp.StatusCode, body))
	}
	return body, nil
}

func stripeErrorSummary(statusCode int, body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	sum := sha256.Sum256(body)
	parts := []string{
		fmt.Sprintf("status=%d", statusCode),
		"body_sha256=" + hex.EncodeToString(sum[:8]),
	}
	if trimmed == "" {
		return strings.Join(parts, " ")
	}
	var decoded struct {
		Error struct {
			Type        string `json:"type"`
			Code        string `json:"code"`
			DeclineCode string `json:"decline_code"`
			RequestID   string `json:"request_id"`
			Message     string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(trimmed), &decoded); err == nil {
		if value := safeStripeErrorToken(decoded.Error.Type); value != "" {
			parts = append(parts, "type="+value)
		}
		if value := safeStripeErrorToken(decoded.Error.Code); value != "" {
			parts = append(parts, "code="+value)
		}
		if value := safeStripeErrorToken(decoded.Error.DeclineCode); value != "" {
			parts = append(parts, "decline_code="+value)
		}
		if value := safeStripeErrorToken(decoded.Error.RequestID); value != "" {
			parts = append(parts, "request_id="+value)
		}
		if value := safeStripeErrorMessage(decoded.Error.Message); value != "" {
			parts = append(parts, "message="+value)
		}
		return strings.Join(parts, " ")
	}
	if value := safeStripeErrorMessage(trimmed); value != "" {
		parts = append(parts, "message="+value)
	}
	return strings.Join(parts, " ")
}

func safeStripeErrorToken(value string) string {
	value = security.RedactString(strings.TrimSpace(value))
	if value == "" || value == security.Redacted {
		return ""
	}
	value = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		case r == '_' || r == '-' || r == '.':
			return r
		default:
			return '_'
		}
	}, value)
	return truncateStripeErrorValue(value, 80)
}

func safeStripeErrorMessage(value string) string {
	value = security.RedactString(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	value = stripeErrorObjectIDPattern.ReplaceAllString(value, security.Redacted)
	value = strings.Join(strings.Fields(value), " ")
	return truncateStripeErrorValue(value, 180)
}

func truncateStripeErrorValue(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	if limit <= 3 {
		return value[:limit]
	}
	return value[:limit-3] + "..."
}

func (a StripeAdapter) testMode() bool {
	mode := strings.TrimSpace(a.Config.Mode)
	return mode == "" || mode == "test"
}

func (a StripeAdapter) client() *http.Client {
	if a.HTTPClient != nil {
		return a.HTTPClient
	}
	return http.DefaultClient
}

func (a StripeAdapter) now() time.Time {
	if a.Now != nil {
		return a.Now().UTC()
	}
	return time.Now().UTC()
}
