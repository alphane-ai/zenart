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

if [[ "${1:-}" == "--contract-only" ]]; then
  grep -q 'docker compose --profile frontend up -d --remove-orphans' "$0"
  grep -q 'docker compose run --rm --entrypoint /app/migrate backend' "$0"
  grep -q 'docker rm -f zenart-manager zenari-manager' "$0"
  grep -q 'azure_staging_proxy.sh' "$0"
  grep -q 'azure_staging_origin_diagnostics.sh' "$0"
  grep -q 'stage1_azure_origin_readiness.py' "$0"
  printf 'azure staging origin repair contract passed\n'
  exit 0
fi

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

zenari_assert_active_azure_staging_target "$TARGET" "Azure staging origin repair target"
printf 'azure staging origin repair target=%s remote_dir=%s\n' "$TARGET" "$REMOTE_RELEASE_DIR"

ssh "${SSH_OPTS[@]}" "$TARGET" "REMOTE_RELEASE_DIR='$REMOTE_RELEASE_DIR' bash -s" <<'REMOTE'
set -euo pipefail

remote_release_dir="${REMOTE_RELEASE_DIR:-/opt/zenari/current}"
if [ ! -f "$remote_release_dir/docker-compose.yml" ]; then
  printf 'remote_release_missing=%s\n' "$remote_release_dir" >&2
  exit 3
fi

cd "$remote_release_dir"
compose_cmd="docker compose"
docker_cmd="docker"
if ! docker info >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  compose_cmd="sudo -n docker compose"
  docker_cmd="sudo -n docker"
fi

$docker_cmd rm -f zenart-manager zenari-manager >/dev/null 2>&1 || true
$compose_cmd --profile frontend up -d --remove-orphans
$compose_cmd run --rm --entrypoint /app/migrate backend
$compose_cmd ps
REMOTE

"$ROOT/scripts/azure_staging_proxy.sh"
"$ROOT/scripts/azure_staging_origin_diagnostics.sh"
python3 "$ROOT/scripts/stage1_azure_origin_readiness.py" --env "$ENV_FILE" --output "$ROOT/ops/evidence/staging/stage1-azure-origin-readiness.json" || test "$?" -eq 2
python3 "$ROOT/scripts/validate_stage1_azure_origin_readiness.py"

printf 'azure staging origin repair completed\n'
