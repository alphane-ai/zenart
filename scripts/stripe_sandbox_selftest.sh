#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

fail() {
  printf 'stripe sandbox selftest failed: %s\n' "$*" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

has_cmd stripe || fail "stripe CLI is not installed"

STRIPE_MODE="${STRIPE_MODE:-test}"
STRIPE_API_KEY="${STRIPE_SECRET_KEY:-${STRIPE_API_KEY:-}}"
STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}}"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-${BILLING_WEBHOOK_SECRET:-}}"
STRIPE_SANDBOX_PRODUCT_ID="${STRIPE_SANDBOX_PRODUCT_ID:-}"
STRIPE_DEFAULT_PRICE_ID="${STRIPE_DEFAULT_PRICE_ID:-}"

is_placeholder() {
  case "$1" in
    ""|replace_me|*_replace_me|*replace_me*|*_from_stripe_cli_listen_print_secret)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

stripe_json() {
  local out
  local err
  out="$(mktemp)"
  err="$(mktemp)"
  if ! STRIPE_API_KEY="$STRIPE_API_KEY" stripe "$@" >"$out" 2>"$err"; then
    python3 - "$err" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
secret_re = re.compile(
    r"(?i)(sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
for line in text.splitlines():
    cleaned = secret_re.sub("[redacted]", line)
    if cleaned.strip():
        print(cleaned, file=sys.stderr)
PY
    rm -f "$out" "$err"
    fail "stripe CLI command failed"
  fi
  cat "$out"
  rm -f "$out" "$err"
}

[[ "$STRIPE_MODE" == "test" ]] || fail "STRIPE_MODE must be test for sandbox selftest"
[[ "$STRIPE_API_KEY" == sk_test_* ]] || fail "STRIPE_SECRET_KEY or STRIPE_API_KEY must be a test secret key"
[[ "$STRIPE_PUBLISHABLE_KEY" == pk_test_* ]] || fail "STRIPE_PUBLISHABLE_KEY must be a test publishable key"
[[ "$STRIPE_WEBHOOK_SECRET" == whsec_* ]] || fail "STRIPE_WEBHOOK_SECRET or BILLING_WEBHOOK_SECRET must start with whsec_"
[[ "$STRIPE_SANDBOX_PRODUCT_ID" == prod_* ]] || fail "STRIPE_SANDBOX_PRODUCT_ID must start with prod_"
[[ "$STRIPE_DEFAULT_PRICE_ID" == price_* ]] || fail "STRIPE_DEFAULT_PRICE_ID must start with price_"
for value_name in STRIPE_API_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET STRIPE_SANDBOX_PRODUCT_ID STRIPE_DEFAULT_PRICE_ID; do
  value="${!value_name}"
  if is_placeholder "$value"; then
    fail "$value_name must not be a placeholder"
  fi
done

balance_json="$(stripe_json balance retrieve)"
python3 - "$balance_json" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload.get("livemode") is not False:
    raise SystemExit("balance livemode must be false")
PY

product_json="$(stripe_json products retrieve "$STRIPE_SANDBOX_PRODUCT_ID")"
python3 - "$product_json" "$STRIPE_SANDBOX_PRODUCT_ID" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
expected_id = sys.argv[2]
if payload.get("id") != expected_id:
    raise SystemExit("product id mismatch")
if payload.get("livemode") is not False:
    raise SystemExit("product livemode must be false")
if not payload.get("active"):
    raise SystemExit("product must be active")
PY

price_json="$(stripe_json prices retrieve "$STRIPE_DEFAULT_PRICE_ID")"
python3 - "$price_json" "$STRIPE_DEFAULT_PRICE_ID" "$STRIPE_SANDBOX_PRODUCT_ID" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
expected_price = sys.argv[2]
expected_product = sys.argv[3]
if payload.get("id") != expected_price:
    raise SystemExit("price id mismatch")
if payload.get("product") != expected_product:
    raise SystemExit("price product mismatch")
if payload.get("livemode") is not False:
    raise SystemExit("price livemode must be false")
if not payload.get("active"):
    raise SystemExit("price must be active")
PY

printf 'stripe sandbox selftest passed: mode=test product=%s price=%s\n' "$STRIPE_SANDBOX_PRODUCT_ID" "$STRIPE_DEFAULT_PRICE_ID"
