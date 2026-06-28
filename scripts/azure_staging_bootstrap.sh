#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
REMOTE_DIR="${STAGING_REMOTE_DIR:-/opt/zenari}"
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

zenari_assert_active_azure_staging_target "$TARGET" "Azure staging bootstrap target"
printf 'azure staging bootstrap target=%s remote_dir=%s\n' "$TARGET" "$REMOTE_DIR"
"$ROOT/scripts/azure_staging_ssh_preflight.sh"

ssh "${SSH_OPTS[@]}" "$TARGET" "REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -euo pipefail

remote_user="$(id -un)"
remote_group="$(id -gn)"
remote_dir="${REMOTE_DIR:-/opt/zenari}"

printf 'bootstrap_remote_user=%s\n' "$remote_user"
printf 'bootstrap_remote_dir=%s\n' "$remote_dir"

if ! command -v sudo >/dev/null 2>&1; then
  printf 'sudo=missing\n' >&2
  exit 3
fi
if ! sudo -n true >/dev/null 2>&1; then
  printf 'passwordless_sudo=missing\n' >&2
  exit 4
fi
printf 'passwordless_sudo=present\n'

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker_install=apt\n'
  sudo -n apt-get update
  compose_pkg="docker-compose-plugin"
  if ! apt-cache show "$compose_pkg" >/dev/null 2>&1 && apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    compose_pkg="docker-compose-v2"
  fi
  sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg docker.io "$compose_pkg"
elif ! docker compose version >/dev/null 2>&1; then
  printf 'docker_compose_plugin_install=apt\n'
  sudo -n apt-get update
  compose_pkg="docker-compose-plugin"
  if ! apt-cache show "$compose_pkg" >/dev/null 2>&1 && apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    compose_pkg="docker-compose-v2"
  fi
  sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y "$compose_pkg"
else
  printf 'docker_install=already_present\n'
fi

sudo -n systemctl enable --now docker >/dev/null 2>&1 || sudo -n service docker start >/dev/null 2>&1 || true
if getent group docker >/dev/null 2>&1; then
  sudo -n usermod -aG docker "$remote_user" || true
fi

sudo -n install -d -m 775 -o "$remote_user" -g "$remote_group" "$remote_dir"
sudo -n install -d -m 775 -o "$remote_user" -g "$remote_group" "$remote_dir/current"

printf 'docker_cli=%s\n' "$(docker --version 2>/dev/null || true)"
if docker compose version >/dev/null 2>&1; then
  printf 'docker_compose=%s\n' "$(docker compose version)"
else
  printf 'docker_compose=missing\n' >&2
  exit 5
fi

if docker info >/dev/null 2>&1; then
  printf 'docker_access=current_user\n'
elif sudo -n docker info >/dev/null 2>&1; then
  printf 'docker_access=sudo_only\n'
else
  printf 'docker_access=missing\n' >&2
  exit 6
fi

printf 'remote_dir_ready=%s\n' "$remote_dir/current"
REMOTE

printf 'azure staging bootstrap completed\n'
