#!/bin/bash

set -euo pipefail

backup_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=packages/twenty-utils/backup/backup-common.sh
source "${backup_script_directory}/backup-common.sh"

backup_install_launch_agents=false
backup_initialize_external=false
backup_json_output=false

usage() {
  cat <<'EOF'
Usage: setup-twenty-backup.sh [options]

Options:
  --install-launch-agents  Only for checkouts outside macOS protected folders
  --initialize-external   Optional: initialize mounted external repositories
  --skip-external
  --json
  --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-launch-agents)
      backup_install_launch_agents=true
      shift
      ;;
    --initialize-external)
      backup_initialize_external=true
      shift
      ;;
    --skip-external)
      backup_initialize_external=false
      shift
      ;;
    --json)
      backup_json_output=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      backup_die "Unknown option: $1"
      usage >&2
      exit 1
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] \
  || { backup_die "This local scheduler setup currently supports macOS only"; exit 1; }

backup_require_command jq
backup_require_command openssl
backup_require_command restic
backup_require_command security

backup_ensure_support_directories
chmod 700 "${backup_script_directory}"/*.sh

if [[ ! -f "${backup_config_path}" ]]; then
  cp "${backup_script_directory}/backup.env.example" "${backup_config_path}"
fi
chmod 600 "${backup_config_path}"

backup_keychain_account="$(id -un)"
backup_keychain_created=false

if ! /usr/bin/security find-generic-password \
  -a "${backup_keychain_account}" \
  -s "${backup_keychain_service}" \
  -w >/dev/null 2>&1; then
  backup_generated_password="$(openssl rand -base64 48)"
  /usr/bin/security add-generic-password \
    -U \
    -a "${backup_keychain_account}" \
    -s "${backup_keychain_service}" \
    -w "${backup_generated_password}" >/dev/null
  unset backup_generated_password
  backup_keychain_created=true
fi

cat >"${backup_support_root}/RECOVERY-KEY-INSTRUCTIONS.txt" <<EOF
Twenty local backups are encrypted with a restic password stored in macOS Keychain.

The password is not copied into the repository or backup logs. Store an offline
copy in your password manager or on paper using this command interactively:

  security find-generic-password -a ${backup_keychain_account} -s ${backup_keychain_service} -w

Losing both the Mac Keychain item and the offline copy makes all restic snapshots
unrecoverable.
EOF
chmod 600 "${backup_support_root}/RECOVERY-KEY-INSTRUCTIONS.txt"

backup_log "Initializing internal encrypted repository"
backup_initialize_repository "${backup_internal_repository}"

backup_primary_initialized=false
backup_secondary_initialized=false

if [[ "${backup_initialize_external}" == true ]]; then
  if backup_is_volume_mounted "${backup_primary_volume}"; then
    backup_log "Initializing ${backup_primary_volume} repository"
    backup_initialize_repository "$(backup_repository_path_for_target primary)"
    backup_primary_initialized=true
  fi

  if backup_is_volume_mounted "${backup_secondary_volume}"; then
    backup_log "Initializing ${backup_secondary_volume} repository"
    backup_initialize_repository "$(backup_repository_path_for_target secondary)"
    backup_secondary_initialized=true
  fi
fi

backup_launch_agents_installed=false

if [[ "${backup_install_launch_agents}" == true ]]; then
  if [[ "${backup_repository_root}" == "${backup_user_home}/Documents/"* ]]; then
    backup_die "macOS blocks background LaunchAgents from this Documents checkout; use the Codex automation schedules documented in README.md"
    exit 1
  fi

  backup_launch_agents_directory="${backup_user_home}/Library/LaunchAgents"
  mkdir -p "${backup_launch_agents_directory}"

  for launch_agent_template in "${backup_script_directory}"/launchd/*.plist; do
    launch_agent_name="$(basename "${launch_agent_template}")"
    launch_agent_destination="${backup_launch_agents_directory}/${launch_agent_name}"
    launch_agent_temporary="$(mktemp "${TMPDIR:-/tmp}/twenty-backup.launch-agent.XXXXXX")"

    sed \
      -e "s|__REPOSITORY_ROOT__|${backup_repository_root}|g" \
      -e "s|__LOG_DIRECTORY__|${backup_log_directory}|g" \
      "${launch_agent_template}" \
      >"${launch_agent_temporary}"

    plutil -lint "${launch_agent_temporary}" >/dev/null
    launchctl bootout "gui/$(id -u)" "${launch_agent_destination}" \
      >/dev/null 2>&1 || true
    install -m 600 "${launch_agent_temporary}" "${launch_agent_destination}"
    rm -f "${launch_agent_temporary}"
    launchctl bootstrap "gui/$(id -u)" "${launch_agent_destination}"
  done

  backup_launch_agents_installed=true
fi

backup_result_json="$(jq -n \
  --arg status "complete" \
  --arg supportRoot "${backup_support_root}" \
  --arg internalRepository "${backup_internal_repository}" \
  --arg primaryVolume "${backup_primary_volume}" \
  --arg secondaryVolume "${backup_secondary_volume}" \
  --argjson keychainCreated "${backup_keychain_created}" \
  --argjson primaryInitialized "${backup_primary_initialized}" \
  --argjson secondaryInitialized "${backup_secondary_initialized}" \
  --argjson launchAgentsInstalled "${backup_launch_agents_installed}" \
  '{
    status: $status,
    supportRoot: $supportRoot,
    internalRepository: $internalRepository,
    keychainCreated: $keychainCreated,
    primary: {volume: $primaryVolume, initialized: $primaryInitialized},
    secondary: {volume: $secondaryVolume, initialized: $secondaryInitialized},
    launchAgentsInstalled: $launchAgentsInstalled
  }')"

if [[ "${backup_json_output}" == true ]]; then
  printf '%s\n' "${backup_result_json}"
else
  printf '%s\n' "${backup_result_json}" | jq .
fi
