#!/bin/bash

# Shared configuration is consumed by the scripts that source this file.
# shellcheck disable=SC2034

set -euo pipefail

backup_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_repository_root="$(cd "${backup_script_directory}/../../.." && pwd)"
backup_compose_file="${backup_repository_root}/packages/twenty-docker/docker-compose.dev.yml"

backup_user_home="${HOME:?HOME must be set}"
backup_support_root="${TWENTY_BACKUP_SUPPORT_ROOT:-${backup_user_home}/Library/Application Support/Twenty Backup}"
backup_config_path="${TWENTY_BACKUP_CONFIG_PATH:-${backup_support_root}/config.env}"

if [[ -f "${backup_config_path}" ]]; then
  # This file is created with mode 600 and is trusted local configuration.
  # shellcheck source=/dev/null
  source "${backup_config_path}"
fi

backup_internal_repository="${TWENTY_BACKUP_INTERNAL_REPOSITORY:-${backup_support_root}/repositories/internal}"
backup_primary_volume="${TWENTY_BACKUP_PRIMARY_VOLUME:-TWENTY_BACKUP_A}"
backup_secondary_volume="${TWENTY_BACKUP_SECONDARY_VOLUME:-TWENTY_BACKUP_B}"
backup_primary_repository_relative_path="${TWENTY_BACKUP_PRIMARY_REPOSITORY_PATH:-restic/twenty}"
backup_secondary_repository_relative_path="${TWENTY_BACKUP_SECONDARY_REPOSITORY_PATH:-restic/twenty}"
backup_require_primary="${TWENTY_BACKUP_REQUIRE_PRIMARY:-false}"
backup_require_secondary="${TWENTY_BACKUP_REQUIRE_SECONDARY:-false}"
backup_database_name="${TWENTY_BACKUP_DATABASE_NAME:-default}"
backup_database_user="${TWENTY_BACKUP_DATABASE_USER:-postgres}"
backup_storage_path="${TWENTY_BACKUP_STORAGE_PATH:-${backup_repository_root}/packages/twenty-server/.local-storage}"
backup_keychain_service="${TWENTY_BACKUP_KEYCHAIN_SERVICE:-com.twenty.local-backup.restic}"
backup_restic_password_reader="${TWENTY_BACKUP_RESTIC_PASSWORD_READER:-${backup_script_directory}/read-restic-password.sh}"
backup_host="${TWENTY_BACKUP_HOST:-twenty-local}"

backup_state_directory="${backup_support_root}/state"
backup_log_directory="${TWENTY_BACKUP_LOG_DIRECTORY:-${backup_user_home}/Library/Logs/Twenty Backup}"
backup_lock_directory=""

backup_log() {
  printf '[twenty-backup] %s\n' "$*" >&2
}

backup_warn() {
  printf '[twenty-backup] WARNING: %s\n' "$*" >&2
}

backup_die() {
  printf '[twenty-backup] ERROR: %s\n' "$*" >&2
  return 1
}

backup_require_command() {
  local command_name="$1"

  command -v "${command_name}" >/dev/null 2>&1 \
    || backup_die "Required command is unavailable: ${command_name}"
}

backup_ensure_support_directories() {
  mkdir -p \
    "${backup_support_root}" \
    "${backup_state_directory}" \
    "${backup_log_directory}" \
    "$(dirname "${backup_internal_repository}")"

  chmod 700 \
    "${backup_support_root}" \
    "${backup_state_directory}" \
    "${backup_log_directory}" \
    "$(dirname "${backup_internal_repository}")"
}

backup_acquire_lock() {
  local lock_name="$1"
  local candidate_lock_directory="${backup_support_root}/locks/${lock_name}.lock"
  local existing_process_id=""

  mkdir -p "${backup_support_root}/locks"
  chmod 700 "${backup_support_root}/locks"

  if mkdir "${candidate_lock_directory}" 2>/dev/null; then
    backup_lock_directory="${candidate_lock_directory}"
    printf '%s\n' "$$" >"${backup_lock_directory}/pid"
    return 0
  fi

  if [[ -f "${candidate_lock_directory}/pid" ]]; then
    existing_process_id="$(<"${candidate_lock_directory}/pid")"
  fi

  if [[ "${existing_process_id}" =~ ^[0-9]+$ ]] \
    && kill -0 "${existing_process_id}" >/dev/null 2>&1; then
    backup_die "Another ${lock_name} operation is already running with PID ${existing_process_id}"
    return 1
  fi

  backup_warn "Removing a stale ${lock_name} lock"
  if [[ "${candidate_lock_directory}" == "${backup_support_root}/locks/"*.lock ]]; then
    rm -f "${candidate_lock_directory}/pid"
    rmdir "${candidate_lock_directory}" 2>/dev/null || true
  fi

  mkdir "${candidate_lock_directory}" \
    || backup_die "Could not acquire ${lock_name} lock"
  backup_lock_directory="${candidate_lock_directory}"
  printf '%s\n' "$$" >"${backup_lock_directory}/pid"
}

backup_release_lock() {
  if [[ -z "${backup_lock_directory}" ]]; then
    return 0
  fi

  if [[ "${backup_lock_directory}" == "${backup_support_root}/locks/"*.lock ]]; then
    rm -f "${backup_lock_directory}/pid"
    rmdir "${backup_lock_directory}" 2>/dev/null || true
  fi

  backup_lock_directory=""
}

backup_volume_mount_path() {
  local volume_name="$1"

  printf '/Volumes/%s\n' "${volume_name}"
}

backup_is_volume_mounted() {
  local volume_name="$1"
  local mount_path=""
  local actual_mount_path=""

  mount_path="$(backup_volume_mount_path "${volume_name}")"

  [[ -d "${mount_path}" ]] || return 1

  if [[ "$(uname -s)" == "Darwin" ]]; then
    actual_mount_path="$(stat -f '%m' "${mount_path}" 2>/dev/null || true)"
    [[ "${actual_mount_path}" == "${mount_path}" ]]
    return
  fi

  command -v findmnt >/dev/null 2>&1 \
    && findmnt --mountpoint "${mount_path}" >/dev/null 2>&1
}

backup_repository_path_for_target() {
  local target_name="$1"

  case "${target_name}" in
    internal)
      printf '%s\n' "${backup_internal_repository}"
      ;;
    primary)
      printf '%s/%s\n' \
        "$(backup_volume_mount_path "${backup_primary_volume}")" \
        "${backup_primary_repository_relative_path}"
      ;;
    secondary)
      printf '%s/%s\n' \
        "$(backup_volume_mount_path "${backup_secondary_volume}")" \
        "${backup_secondary_repository_relative_path}"
      ;;
    *)
      backup_die "Unknown backup target: ${target_name}"
      ;;
  esac
}

backup_resolve_repository_lines() {
  local target_specification="$1"
  local target_token=""
  local -a target_tokens=()
  local -a resolved_targets=()

  IFS=',' read -r -a target_tokens <<<"${target_specification}"

  for target_token in "${target_tokens[@]}"; do
    case "${target_token}" in
      internal)
        resolved_targets+=(internal)
        ;;
      primary)
        backup_is_volume_mounted "${backup_primary_volume}" \
          || backup_die "Required volume ${backup_primary_volume} is not mounted"
        resolved_targets+=(primary)
        ;;
      secondary)
        backup_is_volume_mounted "${backup_secondary_volume}" \
          || backup_die "Required volume ${backup_secondary_volume} is not mounted"
        resolved_targets+=(secondary)
        ;;
      primary-if-mounted)
        if backup_is_volume_mounted "${backup_primary_volume}"; then
          resolved_targets+=(primary)
        fi
        ;;
      secondary-if-mounted)
        if backup_is_volume_mounted "${backup_secondary_volume}"; then
          resolved_targets+=(secondary)
        fi
        ;;
      all-mounted)
        if backup_is_volume_mounted "${backup_primary_volume}"; then
          resolved_targets+=(primary)
        fi
        if backup_is_volume_mounted "${backup_secondary_volume}"; then
          resolved_targets+=(secondary)
        fi
        ;;
      *)
        backup_die "Unknown target selector: ${target_token}"
        return 1
        ;;
    esac
  done

  printf '%s\n' "${resolved_targets[@]}" | awk 'NF && !seen[$0]++'
}

backup_restic() {
  local repository_path="$1"
  shift

  RESTIC_PASSWORD_COMMAND="${backup_restic_password_reader}" \
    restic --repo "${repository_path}" "$@"
}

backup_initialize_repository() {
  local repository_path="$1"

  if [[ -f "${repository_path}/config" ]]; then
    backup_restic "${repository_path}" snapshots --compact >/dev/null
    return 0
  fi

  mkdir -p "${repository_path}"
  chmod 700 "${repository_path}"
  backup_restic "${repository_path}" init >/dev/null
}

backup_latest_complete_snapshot_json() {
  local repository_path="$1"

  backup_restic "${repository_path}" snapshots \
    --host "${backup_host}" \
    --tag twenty-complete \
    --json 2>/dev/null \
    | jq 'sort_by(.time) | reverse | .[:1]'
}

backup_snapshot_age_hours() {
  local repository_path="$1"
  local snapshots_json=""

  snapshots_json="$(backup_latest_complete_snapshot_json "${repository_path}" || true)"

  node -e '
    const snapshots = JSON.parse(process.argv[1] || "[]");
    if (snapshots.length === 0) {
      process.stdout.write("-1");
      process.exit(0);
    }
    const ageMilliseconds = Date.now() - Date.parse(snapshots[0].time);
    process.stdout.write(String(Math.floor(ageMilliseconds / 3600000)));
  ' "${snapshots_json:-[]}" 2>/dev/null || printf '%s' '-1'
}

backup_validate_restore_target() {
  local target_path="$1"
  local normalized_target=""

  [[ -n "${target_path}" ]] || backup_die "Restore target must not be empty"
  [[ "${target_path}" == /* ]] || backup_die "Restore target must be an absolute path"

  normalized_target="${target_path%/}"

  case "${normalized_target}" in
    ""|/|"${backup_user_home}"|"${backup_repository_root}"|"${backup_support_root}"|"${backup_storage_path}"|/Volumes)
      backup_die "Unsafe restore target: ${normalized_target}"
      return 1
      ;;
  esac

  if [[ -e "${normalized_target}" ]] \
    && [[ -n "$(find "${normalized_target}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    backup_die "Restore target must not already contain files: ${normalized_target}"
    return 1
  fi
}

backup_safe_remove_staging_directory() {
  local staging_directory="$1"
  local temporary_root="${TMPDIR:-/tmp}"

  temporary_root="${temporary_root%/}"

  case "${staging_directory}" in
    "${temporary_root}/twenty-backup."*|/tmp/twenty-backup.*|/private/tmp/twenty-backup.*|/private/var/folders/*/twenty-backup.*|/var/folders/*/twenty-backup.*)
      rm -rf -- "${staging_directory}"
      ;;
    *)
      backup_warn "Refusing to remove unexpected staging path: ${staging_directory}"
      ;;
  esac
}
