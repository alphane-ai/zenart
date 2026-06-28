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

SSH_KEY="${STAGING_SSH_KEY:-$HOME/.ssh/id_ed25519_machine_login}"
CONNECT_TIMEOUT="${STAGING_SSH_CONNECT_TIMEOUT:-8}"
SSH_HARD_TIMEOUT="${STAGING_SSH_HARD_TIMEOUT:-20}"
PUBLIC_KEY=""
PUBLIC_KEY_FINGERPRINT="unknown"
if [[ -f "${SSH_KEY}.pub" ]]; then
  PUBLIC_KEY="$(sed -n '1p' "${SSH_KEY}.pub")"
  PUBLIC_KEY_FINGERPRINT="$(ssh-keygen -lf "${SSH_KEY}.pub" 2>/dev/null | awk '{print $2}' || true)"
elif [[ -f "$SSH_KEY" ]]; then
  PUBLIC_KEY="$(ssh-keygen -y -f "$SSH_KEY" 2>/dev/null || true)"
  if [[ -n "$PUBLIC_KEY" ]]; then
    PUBLIC_KEY_FINGERPRINT="$(printf '%s\n' "$PUBLIC_KEY" | ssh-keygen -lf - 2>/dev/null | awk '{print $2}' || true)"
  fi
fi
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

run_with_hard_timeout() {
  local timeout_seconds="$1"
  shift
  local output_file pid status elapsed
  output_file="$(mktemp)"
  "$@" >"$output_file" 2>&1 &
  pid="$!"
  elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( elapsed >= timeout_seconds )); then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
      cat "$output_file"
      rm -f "$output_file"
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid"
  status="$?"
  cat "$output_file"
  rm -f "$output_file"
  return "$status"
}

HOST="${TARGET#*@}"
TARGET_USER="${TARGET%@*}"
zenari_assert_active_azure_staging_target "$TARGET" "Azure staging SSH preflight target"
printf 'azure staging ssh preflight\n'
printf 'target=%s\n' "$TARGET"
printf 'ssh_key=%s\n' "$SSH_KEY"
printf 'ssh_public_key_fingerprint=%s\n' "${PUBLIC_KEY_FINGERPRINT:-unknown}"

if command -v nc >/dev/null 2>&1; then
  if nc -z -w "$CONNECT_TIMEOUT" "$HOST" 22 >/dev/null 2>&1; then
    printf 'tcp_22=reachable\n'
  else
    printf 'tcp_22=unreachable\n' >&2
    exit 3
  fi
fi

set +e
ssh_output="$(
  run_with_hard_timeout "$SSH_HARD_TIMEOUT" ssh "${SSH_OPTS[@]}" "$TARGET" '
set -e
printf "ssh_auth=ok\n"
printf "remote_user=%s\n" "$(id -un)"
printf "remote_host=%s\n" "$(hostname)"
if command -v docker >/dev/null 2>&1; then
  printf "docker_cli=present\n"
  if docker compose version >/dev/null 2>&1; then
    printf "docker_compose=present\n"
  else
    printf "docker_compose=missing\n"
  fi
else
  printf "docker_cli=missing\n"
fi
if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  printf "passwordless_sudo=present\n"
else
  printf "passwordless_sudo=missing\n"
fi
' 2>&1
)"
status=$?
set -e

if [[ "$status" -ne 0 ]]; then
  printf 'ssh_auth=failed\n' >&2
  if [[ "$status" -eq 124 ]]; then
    printf 'ssh_auth_timeout=hard_timeout_after_%ss\n' "$SSH_HARD_TIMEOUT" >&2
  fi
  printf '%s\n' "$ssh_output" >&2
  repair_hint="the TCP port is reachable, but the VM did not accept the configured public key."
  if [[ "$ssh_output" == *"Connection timed out"* || "$ssh_output" == *"Operation timed out"* || "$ssh_output" == *"timed out during banner exchange"* ]]; then
    repair_hint="the TCP port is reachable, but SSH did not complete banner/auth; check sshd health, Azure serial console/Run Command, and NSG/firewall state before retrying key auth."
    printf 'ssh_failure_reason=ssh_connect_timeout\n' >&2
  elif [[ "$ssh_output" == *"not responding"* ]]; then
    repair_hint="the TCP port is reachable, but SSH server keepalive failed; check sshd health and VM resource pressure before retrying key auth."
    printf 'ssh_failure_reason=ssh_server_not_responding\n' >&2
  elif [[ "$ssh_output" == *"Permission denied"* ]]; then
    printf 'ssh_failure_reason=ssh_key_auth_permission_denied\n' >&2
  else
    printf 'ssh_failure_reason=ssh_key_auth_failed\n' >&2
  fi
  if [[ -n "$PUBLIC_KEY" ]]; then
    cat >&2 <<EOF
azure_vm_repair_hint=$repair_hint
azure_vm_repair_where=Azure Portal -> Virtual machines -> target VM -> Run command -> RunShellScript. Do not paste this directly into Cloud Shell.
azure_vm_repair_run_shell_script:
  set -euxo pipefail
  USER_NAME='$TARGET_USER'
  PUBKEY='$PUBLIC_KEY'

  as_root() {
    if [ "\$(id -u)" -eq 0 ]; then
      "\$@"
    else
      sudo "\$@"
    fi
  }

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
  as_root systemctl reload ssh 2>/dev/null || as_root systemctl reload sshd 2>/dev/null || true
  id "\$USER_NAME"
  ls -ld "/home/\$USER_NAME" "/home/\$USER_NAME/.ssh" "/home/\$USER_NAME/.ssh/authorized_keys"
  as_root grep -qxF "\$PUBKEY" "/home/\$USER_NAME/.ssh/authorized_keys"
  printf '%s\n' "\$PUBKEY" | ssh-keygen -lf -
EOF
  fi
  exit "$status"
fi

printf '%s\n' "$ssh_output"
