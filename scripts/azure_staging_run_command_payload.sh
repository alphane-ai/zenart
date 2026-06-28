#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
DEFAULT_OUTPUT="$ROOT/ops/evidence/staging/azure-run-command-ssh-repair.sh"
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

usage() {
  cat <<'USAGE'
Usage: scripts/azure_staging_run_command_payload.sh [--output PATH] [--stdout] [--contract-only]

Generates a paste-ready Azure Portal Run Command / RunShellScript payload for
the staging VM. The payload checks sshd, restores the configured Linux user,
installs the local public SSH key, reloads sshd, and prints only non-secret
diagnostics. It never reads or writes STAGING_SSH_PASSWORD.
USAGE
}

if [[ "${1:-}" == "--contract-only" ]]; then
  grep -q 'Azure Portal Run Command / RunShellScript' "$0"
  grep -q 'STAGING_SSH_PASSWORD' "$0"
  grep -q 'authorized_keys' "$0"
  grep -q 'NOPASSWD:ALL' "$0"
  grep -q 'systemctl status ssh' "$0"
  grep -q 'systemctl status ssh.socket' "$0"
  grep -q 'sshd -t' "$0"
  grep -q '/run/sshd' "$0"
  grep -q 'openssh-server' "$0"
  grep -q 'ufw status' "$0"
  grep -q 'iptables -S' "$0"
  grep -q 'nft list ruleset' "$0"
  grep -q 'waagent' "$0"
  grep -q 'journalctl -u ssh' "$0"
  grep -q 'origin_diagnostics_begin' "$0"
  grep -q 'origin_listener_80' "$0"
  grep -q 'origin_listener_443' "$0"
  grep -q 'origin_listener_5432' "$0"
  grep -q 'origin_listener_26432' "$0"
  grep -q 'local_backend_healthz' "$0"
  grep -q 'local_web_root' "$0"
  grep -q 'local_admin_root' "$0"
  grep -q 'local_caddy_root' "$0"
  grep -q 'docker compose config --services' "$0"
  grep -q 'worker_crawler_backend_image_match' "$0"
  grep -q 'manager_absent' "$0"
  grep -q 'compose_service_postgres' "$0"
  grep -q 'compose_service_backend_state' "$0"
  grep -q 'compose_service_web_state' "$0"
  grep -q 'compose_service_admin_state' "$0"
  grep -q 'compose_service_worker_state' "$0"
  grep -q 'compose_service_crawler_state' "$0"
  grep -q 'compose_core_services_running' "$0"
  grep -q 'origin_postgres_container' "$0"
  grep -q 'backend_database_host_class' "$0"
  grep -q 'staging_quota_replay_db_candidate' "$0"
  grep -q 'PUBLIC_KEY_FINGERPRINT' "$0"
  grep -q 'password_persisted=false' "$0"
  printf 'azure staging run command payload contract passed\n'
  exit 0
fi

OUTPUT="$DEFAULT_OUTPUT"
PRINT_STDOUT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT="${2:?missing --output value}"
      shift 2
      ;;
    --stdout)
      PRINT_STDOUT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

load_env_file

TARGET="${STAGING_SSH_TARGET:-}"
if [[ -z "$TARGET" ]]; then
  if [[ -n "${STAGING_SSH_USER:-}" && -n "${STAGING_SSH_HOST:-}" ]]; then
    TARGET="${STAGING_SSH_USER}@${STAGING_SSH_HOST}"
  else
    TARGET="sansha@52.237.80.117"
  fi
fi
TARGET_USER="${TARGET%@*}"
TARGET_HOST="${TARGET#*@}"
zenari_assert_active_azure_staging_host "$TARGET_HOST" "Azure staging Run Command payload target"
SSH_KEY="${STAGING_SSH_KEY:-$HOME/.ssh/id_ed25519_machine_login}"

PUBLIC_KEY=""
if [[ -f "${SSH_KEY}.pub" ]]; then
  PUBLIC_KEY="$(sed -n '1p' "${SSH_KEY}.pub")"
elif [[ -f "$SSH_KEY" ]]; then
  PUBLIC_KEY="$(ssh-keygen -y -f "$SSH_KEY" 2>/dev/null || true)"
fi
if [[ -z "$PUBLIC_KEY" ]]; then
  printf 'missing local public key for %s; create %s.pub or set STAGING_SSH_KEY\n' "$SSH_KEY" "$SSH_KEY" >&2
  exit 2
fi

PUBLIC_KEY_FINGERPRINT="$(printf '%s\n' "$PUBLIC_KEY" | ssh-keygen -lf - 2>/dev/null | awk '{print $2}' || true)"
mkdir -p "$(dirname "$OUTPUT")"

cat >"$OUTPUT" <<PAYLOAD
#!/usr/bin/env bash
set -euo pipefail

# Paste this into Azure Portal -> Virtual machines -> target VM -> Run command -> RunShellScript.
# Do not paste it into Cloud Shell. It is intended to run inside the Azure staging VM.
# target_host=$TARGET_HOST
# password_persisted=false
# public_key_fingerprint=${PUBLIC_KEY_FINGERPRINT:-unknown}

USER_NAME='$TARGET_USER'
PUBKEY='$PUBLIC_KEY'
PUBLIC_KEY_FINGERPRINT='${PUBLIC_KEY_FINGERPRINT:-unknown}'

as_root() {
  if [ "\$(id -u)" -eq 0 ]; then
    "\$@"
  else
    sudo "\$@"
  fi
}

printf 'zenari_azure_run_command_payload=ssh_repair_v1\n'
printf 'target_user=%s\n' "\$USER_NAME"
printf 'password_persisted=false\n'
printf 'public_key_fingerprint=%s\n' "\$PUBLIC_KEY_FINGERPRINT"
printf 'kernel=%s\n' "\$(uname -a)"
printf 'uptime=%s\n' "\$(uptime || true)"
printf 'disk_root=\\n'
df -h / || true
printf 'memory=\\n'
free -m 2>/dev/null || vmstat -s 2>/dev/null || true
printf 'listening_ssh=\\n'
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || true) | grep -E '(:22\\s|:22$)' || true
printf 'ssh_socket_status=\\n'
systemctl status ssh.socket --no-pager 2>/dev/null || true
printf 'ssh_service_status=\\n'
systemctl status ssh --no-pager 2>/dev/null || systemctl status sshd --no-pager 2>/dev/null || true
printf 'sshd_config_test_before=\\n'
as_root sshd -t 2>&1 || true
printf 'sshd_effective_port=\\n'
as_root sshd -T 2>/dev/null | grep -E '^(port|listenaddress|pubkeyauthentication|passwordauthentication|authorizedkeysfile) ' || true
printf 'ssh_recent_logs=\\n'
journalctl -u ssh -u sshd -n 80 --no-pager 2>/dev/null || true
printf 'azure_agent_recent_logs=\\n'
journalctl -u walinuxagent -u waagent -n 80 --no-pager 2>/dev/null || true
printf 'cloud_init_recent_logs=\\n'
journalctl -u cloud-init -u cloud-final -n 80 --no-pager 2>/dev/null || true
printf 'firewall_summary=\\n'
ufw status verbose 2>/dev/null || true
(as_root iptables -S 2>/dev/null || true) | sed -n '1,80p'
(as_root nft list ruleset 2>/dev/null || true) | sed -n '1,120p'

if ! command -v sshd >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update
    as_root DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server
  elif command -v yum >/dev/null 2>&1; then
    as_root yum install -y openssh-server
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y openssh-server
  fi
fi

as_root install -d -m 755 /run/sshd

if ! id "\$USER_NAME" >/dev/null 2>&1; then
  as_root useradd -m -s /bin/bash -U "\$USER_NAME"
fi

USER_GROUP="\$(id -gn "\$USER_NAME")"
as_root usermod -aG sudo "\$USER_NAME" || true
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "\$USER_NAME" | as_root tee "/etc/sudoers.d/90-\$USER_NAME-zenari-staging" >/dev/null
as_root chmod 440 "/etc/sudoers.d/90-\$USER_NAME-zenari-staging"
as_root install -d -m 700 -o "\$USER_NAME" -g "\$USER_GROUP" "/home/\$USER_NAME/.ssh"
as_root touch "/home/\$USER_NAME/.ssh/authorized_keys"
if ! as_root grep -qxF "\$PUBKEY" "/home/\$USER_NAME/.ssh/authorized_keys"; then
  printf '%s\n' "\$PUBKEY" | as_root tee -a "/home/\$USER_NAME/.ssh/authorized_keys" >/dev/null
fi
as_root chown -R "\$USER_NAME:\$USER_GROUP" "/home/\$USER_NAME/.ssh"
as_root chmod 700 "/home/\$USER_NAME/.ssh"
as_root chmod 600 "/home/\$USER_NAME/.ssh/authorized_keys"

if command -v restorecon >/dev/null 2>&1; then
  as_root restorecon -R "/home/\$USER_NAME/.ssh" || true
fi

as_root systemctl unmask ssh 2>/dev/null || true
as_root systemctl unmask sshd 2>/dev/null || true
as_root systemctl enable ssh 2>/dev/null || as_root systemctl enable sshd 2>/dev/null || true
as_root systemctl restart ssh 2>/dev/null || as_root systemctl restart sshd 2>/dev/null || true
as_root systemctl reload ssh 2>/dev/null || as_root systemctl reload sshd 2>/dev/null || true
as_root systemctl restart ssh.socket 2>/dev/null || true

printf 'sshd_config_test_after=\\n'
as_root sshd -t 2>&1 || true
printf 'ssh_socket_status_after=\\n'
systemctl status ssh.socket --no-pager 2>/dev/null || true
printf 'ssh_service_status_after=\\n'
systemctl status ssh --no-pager 2>/dev/null || systemctl status sshd --no-pager 2>/dev/null || true
printf 'listening_ssh_after=\\n'
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || true) | grep -E '(:22\\s|:22$)' || true

printf 'origin_diagnostics_begin\n'
origin_kv() {
  printf '%s=%s\n' "\$1" "\$2"
}

origin_database_host_class() {
  dsn="\$1"
  if [ -z "\$dsn" ]; then
    printf 'missing'
    return
  fi
  host="\$dsn"
  case "\$host" in
    *@*) host="\${host#*@}" ;;
  esac
  host="\${host#//}"
  host="\${host%%/*}"
  host="\${host%%\\?*}"
  host="\${host%%:*}"
  host="\${host#[}"
  host="\${host%]}"
  host="\$(printf '%s' "\$host" | tr '[:upper:]' '[:lower:]')"
  case "\$host" in
    '') printf 'missing' ;;
    localhost|127.*|0.0.0.0|::1) printf 'local_loopback' ;;
    postgres|zenari-postgres|zenari-stage0-postgres-1) printf 'compose_service' ;;
    10.*|192.168.*|169.254.*) printf 'private_ip' ;;
    172.*)
      second_octet="\${host#172.}"
      second_octet="\${second_octet%%.*}"
      if [ "\$second_octet" -ge 16 ] && [ "\$second_octet" -le 31 ] 2>/dev/null; then
        printf 'private_ip'
      else
        printf 'public_or_external'
      fi
      ;;
    *.local|*.localhost|*.test|*.invalid|*.example) printf 'reserved_or_unclassified' ;;
    *) printf 'public_or_external' ;;
  esac
}

origin_probe() {
  probe_name="\$1"
  probe_url="\$2"
  probe_status="\$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 3 --max-time 8 "\$probe_url" 2>/dev/null || true)"
  if [ -z "\$probe_status" ] || [ "\$probe_status" = "000" ]; then
    origin_kv "\$probe_name" blocked
  else
    origin_kv "\$probe_name" "\$probe_status"
  fi
}

origin_kv origin_diag_version v1
origin_kv origin_release_dir /opt/zenari/current
if command -v docker >/dev/null 2>&1; then
  origin_kv docker_cli present
else
  origin_kv docker_cli missing
fi
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  origin_kv docker_compose present
else
  origin_kv docker_compose missing
fi
if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  origin_kv passwordless_sudo present
else
  origin_kv passwordless_sudo missing
fi

origin_ports="\$(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || true)"
# Emitted keys include origin_listener_80, origin_listener_443,
# origin_listener_31080, origin_listener_26080, origin_listener_26081,
# origin_listener_5432, and origin_listener_26432.
for origin_port in 80 443 31080 26080 26081 5432 26432; do
  if printf '%s\n' "\$origin_ports" | grep -Eq "[:.]\$origin_port[[:space:]]"; then
    origin_kv "origin_listener_\$origin_port" present
  else
    origin_kv "origin_listener_\$origin_port" missing
  fi
done

compose_cmd='docker compose'
docker_cmd='docker'
if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  compose_cmd='sudo -n docker compose'
  docker_cmd='sudo -n docker'
fi

if [ -d /opt/zenari/current ]; then
  origin_kv release_dir_present true
else
  origin_kv release_dir_present false
fi

if [ -f /opt/zenari/current/docker-compose.yml ]; then
  origin_kv compose_file_present true
  cd /opt/zenari/current
  if \$compose_cmd config --services >/tmp/zenari-compose-services.txt 2>/dev/null; then
    compose_services="\$(tr '\n' ',' </tmp/zenari-compose-services.txt | sed 's/,\$//')"
    origin_kv compose_services "\${compose_services:-none}"
    # Emitted keys include compose_service_backend, compose_service_web,
    # compose_service_admin, compose_service_worker, compose_service_crawler,
    # compose_service_manager, and compose_service_postgres.
    for service_name in backend web admin worker crawler manager postgres; do
      if grep -qx "\$service_name" /tmp/zenari-compose-services.txt; then
        origin_kv "compose_service_\$service_name" present
      else
        origin_kv "compose_service_\$service_name" absent
      fi
    done
  else
    origin_kv compose_services unreadable
  fi

  image_for_service() {
    svc="\$1"
    cid="\$(\$compose_cmd ps -q "\$svc" 2>/dev/null | sed -n '1p' || true)"
    if [ -n "\$cid" ]; then
      \$docker_cmd inspect --format '{{.Config.Image}}' "\$cid" 2>/dev/null || true
    fi
  }

  state_for_service() {
    svc="\$1"
    cid="\$(\$compose_cmd ps -q "\$svc" 2>/dev/null | sed -n '1p' || true)"
    if [ -z "\$cid" ]; then
      printf 'missing'
      return
    fi
    state="\$(\$docker_cmd inspect --format '{{.State.Status}}' "\$cid" 2>/dev/null || true)"
    if [ -n "\$state" ]; then
      printf '%s' "\$state"
    else
      printf 'unknown'
    fi
  }

  compose_core_services_running=true
  for service_name in backend web admin worker crawler; do
    service_state="\$(state_for_service "\$service_name")"
    origin_kv "compose_service_\${service_name}_state" "\$service_state"
    if [ "\$service_state" != "running" ]; then
      compose_core_services_running=false
    fi
  done
  origin_kv compose_core_services_running "\$compose_core_services_running"

  backend_image="\$(image_for_service backend)"
  worker_image="\$(image_for_service worker)"
  crawler_image="\$(image_for_service crawler)"
  if [ -n "\$backend_image" ] && [ -n "\$worker_image" ] && [ -n "\$crawler_image" ]; then
    if [ "\$backend_image" = "\$worker_image" ] && [ "\$backend_image" = "\$crawler_image" ]; then
      origin_kv worker_crawler_backend_image_match true
    else
      origin_kv worker_crawler_backend_image_match false
    fi
  else
    origin_kv worker_crawler_backend_image_match unknown
  fi

  postgres_cid="\$(\$compose_cmd ps -q postgres 2>/dev/null | sed -n '1p' || true)"
  if [ -n "\$postgres_cid" ]; then
    postgres_state="\$(\$docker_cmd inspect --format '{{.State.Status}}' "\$postgres_cid" 2>/dev/null || true)"
    origin_kv origin_postgres_container "\${postgres_state:-present}"
  else
    postgres_state=missing
    origin_kv origin_postgres_container missing
  fi

  origin_container_env() {
    svc="\$1"
    key="\$2"
    cid="\$(\$compose_cmd ps -q "\$svc" 2>/dev/null | sed -n '1p' || true)"
    if [ -z "\$cid" ]; then
      return 0
    fi
    \$docker_cmd inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "\$cid" 2>/dev/null \
      | awk -F= -v key="\$key" '\$1 == key {print substr(\$0, length(key) + 2); exit}'
  }

  backend_database_url="\$(origin_container_env backend DATABASE_URL || true)"
  if [ -n "\$backend_database_url" ]; then
    backend_database_host_class="\$(origin_database_host_class "\$backend_database_url")"
    origin_kv backend_database_url_present true
    origin_kv backend_database_host_class "\$backend_database_host_class"
  else
    backend_database_host_class=missing
    origin_kv backend_database_url_present false
    origin_kv backend_database_host_class missing
  fi
  if [ "\$backend_database_host_class" = "public_or_external" ]; then
    origin_kv staging_quota_replay_db_candidate external
  elif [ "\$backend_database_host_class" = "compose_service" ] && [ "\$postgres_state" = "running" ]; then
    origin_kv staging_quota_replay_db_candidate local_compose
  elif [ "\$backend_database_host_class" = "missing" ]; then
    origin_kv staging_quota_replay_db_candidate missing
  else
    origin_kv staging_quota_replay_db_candidate redacted_or_unclassified
  fi
else
  origin_kv compose_file_present false
  origin_kv compose_service_backend_state missing
  origin_kv compose_service_web_state missing
  origin_kv compose_service_admin_state missing
  origin_kv compose_service_worker_state missing
  origin_kv compose_service_crawler_state missing
  origin_kv compose_core_services_running false
  origin_kv worker_crawler_backend_image_match unknown
  origin_kv origin_postgres_container unknown
  origin_kv backend_database_url_present false
  origin_kv backend_database_host_class missing
  origin_kv staging_quota_replay_db_candidate missing
fi

if command -v docker >/dev/null 2>&1 && \$docker_cmd ps -a --format '{{.Names}}' 2>/dev/null | grep -Eq '^(zenart-manager|zenari-manager|manager)$'; then
  origin_kv manager_absent false
else
  origin_kv manager_absent true
fi

if command -v docker >/dev/null 2>&1 && \$docker_cmd ps -a --format '{{.Names}}' 2>/dev/null | grep -qx zenari-caddy; then
  origin_kv caddy_container present
  if \$docker_cmd ps --format '{{.Names}}' 2>/dev/null | grep -qx zenari-caddy; then
    origin_kv caddy_running true
  else
    origin_kv caddy_running false
  fi
else
  origin_kv caddy_container missing
  origin_kv caddy_running false
fi

origin_probe local_backend_healthz http://127.0.0.1:31080/healthz
origin_probe local_backend_readyz http://127.0.0.1:31080/readyz
origin_probe local_web_root http://127.0.0.1:26080/
origin_probe local_admin_root http://127.0.0.1:26081/
origin_probe local_caddy_healthz http://127.0.0.1/healthz
origin_probe local_caddy_root http://127.0.0.1/
printf 'origin_diagnostics_end\n'

id "\$USER_NAME"
ls -ld "/home/\$USER_NAME" "/home/\$USER_NAME/.ssh" "/home/\$USER_NAME/.ssh/authorized_keys"
as_root grep -qxF "\$PUBKEY" "/home/\$USER_NAME/.ssh/authorized_keys"
printf '%s\n' "\$PUBKEY" | ssh-keygen -lf -
printf 'zenari_azure_run_command_payload=complete\n'
PAYLOAD

chmod 600 "$OUTPUT"
printf 'azure_run_command_payload_written=%s\n' "$OUTPUT"
printf 'target=%s\n' "$TARGET"
printf 'public_key_fingerprint=%s\n' "${PUBLIC_KEY_FINGERPRINT:-unknown}"
printf 'password_persisted=false\n'
printf 'paste_where=Azure Portal -> Virtual machines -> target VM -> Run command -> RunShellScript\n'
if [[ "$PRINT_STDOUT" == "1" ]]; then
  cat "$OUTPUT"
fi
