#!/bin/bash

set -euo pipefail

backup_test_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_test_repository_root="$(cd "${backup_test_script_directory}/../../.." && pwd)"
backup_test_root="$(mktemp -d "${TMPDIR:-/tmp}/twenty-backup.test.XXXXXX")"

test_cleanup() {
  rm -rf -- "${backup_test_root}"
}

trap test_cleanup EXIT INT TERM

export TWENTY_BACKUP_SUPPORT_ROOT="${backup_test_root}/support"
export TWENTY_BACKUP_LOG_DIRECTORY="${backup_test_root}/logs"
export TMPDIR="${backup_test_root}/tmp/"
mkdir -p "${TMPDIR}"

# shellcheck source=packages/twenty-utils/backup/backup-common.sh
source "${backup_test_script_directory}/backup-common.sh"

assert_fails() {
  if "$@" >/dev/null 2>&1; then
    printf 'Expected command to fail: %s\n' "$*" >&2
    exit 1
  fi
}

assert_equals() {
  local expected="$1"
  local actual="$2"

  if [[ "${expected}" != "${actual}" ]]; then
    printf 'Expected %q but received %q\n' "${expected}" "${actual}" >&2
    exit 1
  fi
}

backup_ensure_support_directories

assert_fails backup_validate_restore_target /
assert_fails backup_validate_restore_target "${backup_user_home}"
assert_fails backup_validate_restore_target "${backup_repository_root}"
assert_fails backup_validate_restore_target "${backup_support_root}"
assert_fails backup_validate_restore_target "${backup_storage_path}"

safe_restore_target="${backup_test_root}/restore-target"
backup_validate_restore_target "${safe_restore_target}"
mkdir -p "${safe_restore_target}"
printf 'occupied\n' >"${safe_restore_target}/file"
assert_fails backup_validate_restore_target "${safe_restore_target}"

resolved_internal="$(backup_resolve_repository_lines internal)"
assert_equals internal "${resolved_internal}"

resolved_optional="$(backup_resolve_repository_lines 'internal,primary-if-mounted')"
assert_equals internal "${resolved_optional}"

staging_directory="${TMPDIR%/}/twenty-backup.safe-test"
mkdir -p "${staging_directory}"
printf 'temporary\n' >"${staging_directory}/file"
backup_safe_remove_staging_directory "${staging_directory}"
[[ ! -e "${staging_directory}" ]]

unsafe_directory="${backup_test_root}/must-remain"
mkdir -p "${unsafe_directory}"
backup_safe_remove_staging_directory "${unsafe_directory}"
[[ -d "${unsafe_directory}" ]]

backup_acquire_lock safety-test
# shellcheck disable=SC2016
assert_fails bash -c \
  'source "$1/backup-common.sh"; backup_acquire_lock safety-test' \
  bash "${backup_test_script_directory}"
backup_release_lock

for launch_agent_template in "${backup_test_script_directory}"/launchd/*.plist; do
  rendered_plist="${backup_test_root}/$(basename "${launch_agent_template}")"
  sed \
    -e "s|__REPOSITORY_ROOT__|${backup_test_repository_root}|g" \
    -e "s|__LOG_DIRECTORY__|${backup_test_root}/logs|g" \
    "${launch_agent_template}" \
    >"${rendered_plist}"
  plutil -lint "${rendered_plist}" >/dev/null
done

printf 'Twenty backup safety tests passed.\n'
