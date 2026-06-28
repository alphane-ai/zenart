#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
REMOTE_DIR="${STAGING_REMOTE_DIR:-/opt/zenari}"
REMOTE_RELEASE_DIR="${REMOTE_DIR}/current"
source "$ROOT/scripts/azure_staging_target_guard.sh"

load_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    if [[ -n "$key" && -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done <"$ENV_FILE"
}

load_env_file

TARGET="${STAGING_SSH_TARGET:-}"
if [[ -z "$TARGET" ]]; then
  if [[ -n "${STAGING_SSH_USER:-}" && -n "${STAGING_SSH_HOST:-}" ]]; then
    TARGET="${STAGING_SSH_USER}@${STAGING_SSH_HOST}"
  else
    printf 'missing STAGING_SSH_TARGET or STAGING_SSH_USER/STAGING_SSH_HOST in %s\n' "$ENV_FILE" >&2
    exit 2
  fi
fi

SSH_KEY="${STAGING_SSH_KEY:-$HOME/.ssh/id_ed25519_machine_login}"
CONNECT_TIMEOUT="${STAGING_SSH_CONNECT_TIMEOUT:-8}"
SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout="$CONNECT_TIMEOUT"
  -o ServerAliveInterval=5
  -o ServerAliveCountMax=2
  -o StrictHostKeyChecking=accept-new
  -o IdentitiesOnly=yes
)
if [[ -f "$SSH_KEY" ]]; then
  SSH_OPTS=(-i "$SSH_KEY" "${SSH_OPTS[@]}")
fi

RSYNC_SSH="ssh"
if [[ -f "$SSH_KEY" ]]; then
  RSYNC_SSH="$RSYNC_SSH -i $SSH_KEY"
fi
RSYNC_SSH="$RSYNC_SSH -o BatchMode=yes -o ConnectTimeout=$CONNECT_TIMEOUT -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s is required\n' "$1" >&2
    exit 2
  fi
}

require_cmd rsync
require_cmd ssh

zenari_assert_active_azure_staging_target "$TARGET" "Azure staging deploy target"
printf 'azure staging deploy target=%s remote_dir=%s\n' "$TARGET" "$REMOTE_DIR"
printf 'running ssh preflight...\n'
"$ROOT/scripts/azure_staging_ssh_preflight.sh"

printf 'running remote bootstrap...\n'
"$ROOT/scripts/azure_staging_bootstrap.sh"

printf 'preparing remote directory...\n'
ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '$REMOTE_RELEASE_DIR' 2>/dev/null || { sudo -n mkdir -p '$REMOTE_RELEASE_DIR' && sudo -n chown -R \"\$(id -un):\$(id -gn)\" '$REMOTE_DIR'; }"

printf 'syncing repository source...\n'
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude 'node_modules/' \
  --exclude 'web/node_modules/' \
  --exclude 'admin/node_modules/' \
  --exclude '.next/' \
  --exclude 'web/.next/' \
  --exclude 'admin/.next/' \
  --exclude 'test-results/' \
  --exclude 'web/test-results/' \
  --exclude 'admin/test-results/' \
  --exclude 'tmp/' \
  -e "$RSYNC_SSH" \
  "$ROOT/" "$TARGET:$REMOTE_RELEASE_DIR/"

printf 'syncing ignored staging env to remote .env...\n'
rsync -az -e "$RSYNC_SSH" "$ENV_FILE" "$TARGET:$REMOTE_RELEASE_DIR/.env"

printf 'starting docker compose stack on remote...\n'
ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$REMOTE_RELEASE_DIR' && if docker info >/dev/null 2>&1; then docker rm -f zenart-manager zenari-manager >/dev/null 2>&1 || true; docker compose --profile frontend up -d --build --remove-orphans; else sudo -n docker rm -f zenart-manager zenari-manager >/dev/null 2>&1 || true; sudo -n docker compose --profile frontend up -d --build --remove-orphans; fi"

printf 'running migrations on remote backend image...\n'
ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$REMOTE_RELEASE_DIR' && if docker info >/dev/null 2>&1; then docker compose run --rm --entrypoint /app/migrate backend; else sudo -n docker compose run --rm --entrypoint /app/migrate backend; fi"

printf 'checking remote containers...\n'
ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$REMOTE_RELEASE_DIR' && if docker info >/dev/null 2>&1; then docker compose ps; else sudo -n docker compose ps; fi"

printf 'verifying remote release image boundary...\n'
REMOTE_COMPOSE_PS_JSON="$(
  ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$REMOTE_RELEASE_DIR' && if docker info >/dev/null 2>&1; then docker compose ps --format json; else sudo -n docker compose ps --format json; fi"
)"
printf '%s\n' "$REMOTE_COMPOSE_PS_JSON" | python3 -c '
import json
import sys

rows = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        rows.append(json.loads(line))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"remote compose ps emitted invalid JSON: {exc}: {line[:120]}")

by_service = {row.get("Service"): row for row in rows}
for required in ("backend", "worker", "crawler", "web", "admin"):
    row = by_service.get(required)
    if not row:
        raise SystemExit(f"missing running compose service: {required}")
    if str(row.get("State") or "").lower() != "running":
        raise SystemExit(f"compose service {required} is not running: {row}")
if "manager" in by_service:
    raise SystemExit("legacy manager service is running in default staging release")

backend_image = str(by_service["backend"].get("Image") or "")
for service in ("worker", "crawler"):
    image = str(by_service[service].get("Image") or "")
    if image != backend_image:
        raise SystemExit(f"{service} image {image!r} must match backend image {backend_image!r}")
print("remote release image boundary verified: web/admin/backend only; worker/crawler share backend image")
'

API_URL="${STAGING_API_URL:-}"
if [[ -n "$API_URL" ]]; then
  printf 'checking local reachability for %s/healthz\n' "$API_URL"
  curl --silent --show-error --max-time 10 --insecure "$API_URL/healthz" >/tmp/zenari-azure-staging-healthz.body
  printf 'healthz_body_saved=/tmp/zenari-azure-staging-healthz.body\n'
fi

printf 'azure staging deploy completed\n'
