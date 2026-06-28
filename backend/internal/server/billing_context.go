package server

import (
	"context"

	"github.com/alphane-ai/zenart/backend/internal/billing"
)

type billingProviderKey struct{}
type billingAccountReaderKey struct{}
type billingAdminOperatorKey struct{}
type teamSeatBillingSyncerKey struct{}
type teamSeatBillingManagerKey struct{}

func ContextWithBillingProvider(ctx context.Context, provider billing.PaidProviderAdapter) context.Context {
	return context.WithValue(ctx, billingProviderKey{}, provider)
}

func billingProviderFromContext(ctx context.Context) (billing.PaidProviderAdapter, bool) {
	provider, ok := ctx.Value(billingProviderKey{}).(billing.PaidProviderAdapter)
	return provider, ok
}

func ContextWithBillingAccountReader(ctx context.Context, reader billing.AccountReader) context.Context {
	return context.WithValue(ctx, billingAccountReaderKey{}, reader)
}

func billingAccountReaderFromContext(ctx context.Context) (billing.AccountReader, bool) {
	reader, ok := ctx.Value(billingAccountReaderKey{}).(billing.AccountReader)
	return reader, ok
}

func ContextWithBillingAdminOperator(ctx context.Context, operator billing.AdminBillingOperator) context.Context {
	return context.WithValue(ctx, billingAdminOperatorKey{}, operator)
}

func billingAdminOperatorFromContext(ctx context.Context) (billing.AdminBillingOperator, bool) {
	operator, ok := ctx.Value(billingAdminOperatorKey{}).(billing.AdminBillingOperator)
	return operator, ok
}

func ContextWithTeamSeatBillingSyncer(ctx context.Context, syncer billing.TeamSeatBillingSyncer) context.Context {
	return context.WithValue(ctx, teamSeatBillingSyncerKey{}, syncer)
}

func teamSeatBillingSyncerFromContext(ctx context.Context) (billing.TeamSeatBillingSyncer, bool) {
	if manager, ok := teamSeatBillingManagerFromContext(ctx); ok {
		return manager, true
	}
	syncer, ok := ctx.Value(teamSeatBillingSyncerKey{}).(billing.TeamSeatBillingSyncer)
	return syncer, ok
}

func ContextWithTeamSeatBillingManager(ctx context.Context, manager billing.TeamSeatBillingManager) context.Context {
	ctx = context.WithValue(ctx, teamSeatBillingManagerKey{}, manager)
	return ContextWithTeamSeatBillingSyncer(ctx, manager)
}

func teamSeatBillingManagerFromContext(ctx context.Context) (billing.TeamSeatBillingManager, bool) {
	manager, ok := ctx.Value(teamSeatBillingManagerKey{}).(billing.TeamSeatBillingManager)
	return manager, ok
}
