#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
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

PUBLIC_HOST="${STAGING_PUBLIC_HOST:-staging.zenari.ai}"
ADMIN_HOST="${STAGING_ADMIN_HOST:-}"
PRODUCTION_HOSTS=""
if [[ "${STAGING_INCLUDE_PRODUCTION_HOSTS:-0}" == "1" ]]; then
  PRODUCTION_HOSTS="${STAGING_PRODUCTION_HOSTS:-zenari.ai,www.zenari.ai}"
fi

validate_production_hosts_dns_ready() {
  local production_hosts_csv="$1"
  [[ -n "$production_hosts_csv" ]] || return 0
  python3 - "$production_hosts_csv" <<'PY'
import socket
import sys

allowed_hosts = {"zenari.ai", "www.zenari.ai"}
hosts = []
for raw_host in sys.argv[1].split(","):
    host = raw_host.strip()
    if not host:
        continue
    if host not in allowed_hosts:
        print(f"invalid_production_host={host}", file=sys.stderr)
        sys.exit(2)
    if host not in hosts:
        hosts.append(host)

for host in hosts:
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        print(f"production_host_dns_not_ready={host}", file=sys.stderr)
        print(
            "set A/AAAA before enabling STAGING_INCLUDE_PRODUCTION_HOSTS to avoid ACME failures",
            file=sys.stderr,
        )
        sys.exit(2)
    addresses = {
        info[4][0]
        for info in infos
        if info[0] in (socket.AF_INET, socket.AF_INET6) and info[4]
    }
    if not addresses:
        print(f"production_host_dns_not_ready={host}", file=sys.stderr)
        print(
            "set A/AAAA before enabling STAGING_INCLUDE_PRODUCTION_HOSTS to avoid ACME failures",
            file=sys.stderr,
        )
        sys.exit(2)
PY
}

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

zenari_assert_active_azure_staging_target "$TARGET" "Azure staging proxy target"
validate_production_hosts_dns_ready "$PRODUCTION_HOSTS"
printf 'azure staging proxy target=%s public_host=%s production_hosts=%s\n' "$TARGET" "$PUBLIC_HOST" "${PRODUCTION_HOSTS:-none}"

ssh "${SSH_OPTS[@]}" "$TARGET" \
  "PUBLIC_HOST='$PUBLIC_HOST' ADMIN_HOST='$ADMIN_HOST' PRODUCTION_HOSTS='$PRODUCTION_HOSTS' bash -s" <<'REMOTE'
set -euo pipefail

public_host="${PUBLIC_HOST:?}"
admin_host="${ADMIN_HOST:-}"
production_hosts_csv="${PRODUCTION_HOSTS:-}"
caddy_dir="/opt/zenari/caddy"
site_hosts="$public_host"
if [ -n "$production_hosts_csv" ]; then
  old_ifs="$IFS"
  IFS=","
  for host in $production_hosts_csv; do
    host="$(printf '%s' "$host" | tr -d '[:space:]')"
    [ -n "$host" ] || continue
    case "$host" in
      zenari.ai|www.zenari.ai)
        case " $site_hosts " in
          *" $host "*) ;;
          *) site_hosts="$site_hosts, $host" ;;
        esac
        ;;
      *)
        printf 'invalid_production_host=%s\n' "$host" >&2
        exit 2
        ;;
    esac
  done
  IFS="$old_ifs"
fi

sudo -n install -d -m 755 "$caddy_dir"
sudo -n install -d -m 755 "$caddy_dir/data" "$caddy_dir/config"

sudo -n tee "$caddy_dir/Caddyfile" >/dev/null <<EOF
{
	email admin@zenari.ai
}

$site_hosts {
	encode zstd gzip
	reverse_proxy /healthz 127.0.0.1:31080
	reverse_proxy /readyz 127.0.0.1:31080
	reverse_proxy /api/* 127.0.0.1:31080
	reverse_proxy /admin 127.0.0.1:26081
	reverse_proxy /admin/* 127.0.0.1:26081
	reverse_proxy 127.0.0.1:26080
}
EOF

if [ -n "$admin_host" ]; then
  sudo -n tee -a "$caddy_dir/Caddyfile" >/dev/null <<EOF

$admin_host {
	encode zstd gzip
	reverse_proxy 127.0.0.1:26081
}
EOF
fi

if docker ps -a --format '{{.Names}}' | grep -qx zenari-caddy; then
  docker rm -f zenari-caddy >/dev/null
fi

docker run -d \
  --name zenari-caddy \
  --restart unless-stopped \
  --network host \
  -v "$caddy_dir/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$caddy_dir/data:/data" \
  -v "$caddy_dir/config:/config" \
  caddy:2.9-alpine >/dev/null

printf 'caddy_container=running\n'
docker ps --filter name=zenari-caddy --format 'name={{.Names}} status={{.Status}} image={{.Image}}'
REMOTE

printf 'azure staging proxy completed\n'
