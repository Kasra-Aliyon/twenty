#!/bin/bash

set -euo pipefail

backup_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=packages/twenty-utils/backup/backup-common.sh
source "${backup_script_directory}/backup-common.sh"

backup_temporary_root="${TMPDIR:-/tmp}"
backup_temporary_root="${backup_temporary_root%/}"
backup_restore_test_directory="$(mktemp -d "${backup_temporary_root}/twenty-backup.restore-test.XXXXXX")"

restore_test_cleanup() {
  local exit_code=$?

  set +e
  backup_safe_remove_staging_directory "${backup_restore_test_directory}"
  exit "${exit_code}"
}

trap restore_test_cleanup EXIT INT TERM

"${backup_script_directory}/restore-twenty-backup.sh" \
  --repository internal \
  --snapshot latest \
  --target-directory "${backup_restore_test_directory}" \
  --verify-database \
  --json
