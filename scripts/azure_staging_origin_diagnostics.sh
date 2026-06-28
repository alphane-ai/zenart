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
  grep -q 'zenari-caddy' "$0"
  grep -q 'docker compose ps --format json' "$0"
  grep -q '127.0.0.1:31080/healthz' "$0"
  grep -q '127.0.0.1:26080' "$0"
  grep -q '127.0.0.1:26081' "$0"
  grep -q 'ss -ltnp' "$0"
  grep -q 'manager_absent' "$0"
  grep -q 'worker_crawler_backend_image_match' "$0"
  printf 'azure staging origin diagnostics contract passed\n'
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

zenari_assert_active_azure_staging_target "$TARGET" "Azure staging origin diagnostics target"
printf 'azure staging origin diagnostics target=%s remote_dir=%s\n' "$TARGET" "$REMOTE_RELEASE_DIR"

ssh "${SSH_OPTS[@]}" "$TARGET" "REMOTE_RELEASE_DIR='$REMOTE_RELEASE_DIR' bash -s" <<'REMOTE'
set -euo pipefail

remote_release_dir="${REMOTE_RELEASE_DIR:-/opt/zenari/current}"

line() {
  printf '%s=%s\n' "$1" "$2"
}

line remote_user "$(id -un)"
line remote_host "$(hostname)"
line release_dir "$remote_release_dir"

if command -v docker >/dev/null 2>&1; then
  line docker_cli present
else
  line docker_cli missing
fi

if docker compose version >/dev/null 2>&1; then
  line docker_compose present
else
  line docker_compose missing
fi

if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  line passwordless_sudo present
else
  line passwordless_sudo missing
fi

if command -v ss >/dev/null 2>&1; then
  printf 'listening_ports_begin\n'
  (sudo -n ss -ltnp 2>/dev/null || ss -ltnp 2>/dev/null || true) | awk 'NR == 1 || /:(22|80|443|26080|26081|31080)\b/'
  printf 'listening_ports_end\n'
else
  line ss missing
fi

if [ -d "$remote_release_dir" ]; then
  line release_dir_present true
else
  line release_dir_present false
fi

if [ -f "$remote_release_dir/docker-compose.yml" ]; then
  cd "$remote_release_dir"
  compose_cmd="docker compose"
  if ! docker info >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
    compose_cmd="sudo -n docker compose"
  fi
  printf 'compose_ps_json_begin\n'
  $compose_cmd ps --format json 2>/dev/null || true
  printf 'compose_ps_json_end\n'

  backend_image="$($compose_cmd ps --format json 2>/dev/null | awk 'BEGIN{FS="\""} /"Service":"backend"/{for(i=1;i<=NF;i++){if($i=="Image"){print $(i+2); exit}}}' || true)"
  worker_image="$($compose_cmd ps --format json 2>/dev/null | awk 'BEGIN{FS="\""} /"Service":"worker"/{for(i=1;i<=NF;i++){if($i=="Image"){print $(i+2); exit}}}' || true)"
  crawler_image="$($compose_cmd ps --format json 2>/dev/null | awk 'BEGIN{FS="\""} /"Service":"crawler"/{for(i=1;i<=NF;i++){if($i=="Image"){print $(i+2); exit}}}' || true)"
  if [ -n "$backend_image" ] && [ "$backend_image" = "$worker_image" ] && [ "$backend_image" = "$crawler_image" ]; then
    line worker_crawler_backend_image_match true
  else
    line worker_crawler_backend_image_match false
  fi
  if $compose_cmd ps --format json 2>/dev/null | grep -q '"Service":"manager"'; then
    line manager_absent false
  else
    line manager_absent true
  fi
else
  line compose_file_present false
fi

if docker ps -a --format '{{.Names}}' | grep -qx zenari-caddy; then
  line caddy_container present
  docker ps --filter name=zenari-caddy --format 'caddy_status={{.Status}} image={{.Image}}'
  printf 'caddy_logs_tail_begin\n'
  docker logs --tail 80 zenari-caddy 2>&1 | sed -E 's/(Authorization:|Cookie:|Set-Cookie:|token=|secret=|password=)[^[:space:]]+/\1[redacted]/gi' || true
  printf 'caddy_logs_tail_end\n'
else
  line caddy_container missing
fi

probe() {
  name="$1"
  url="$2"
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 3 --max-time 8 "$url" 2>/dev/null || true)"
  if [ -z "$status" ] || [ "$status" = "000" ]; then
    line "$name" "blocked"
  else
    line "$name" "$status"
  fi
}

probe local_backend_healthz http://127.0.0.1:31080/healthz
probe local_backend_readyz http://127.0.0.1:31080/readyz
probe local_web_root http://127.0.0.1:26080/
probe local_admin_root http://127.0.0.1:26081/
probe local_caddy_healthz http://127.0.0.1/healthz
probe local_caddy_root http://127.0.0.1/
REMOTE

printf 'azure staging origin diagnostics completed\n'
