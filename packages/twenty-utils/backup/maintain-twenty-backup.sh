#!/bin/bash

set -euo pipefail

backup_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=packages/twenty-utils/backup/backup-common.sh
source "${backup_script_directory}/backup-common.sh"

backup_repository_target="internal"
backup_apply=false
backup_json_output=false

usage() {
  cat <<'EOF'
Usage: maintain-twenty-backup.sh [options]

Retention is dry-run by default. --apply operates on exactly one repository,
runs restic check first, then forgets and prunes according to its policy.

Options:
  --repository internal|primary|secondary
  --apply
  --json
  --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repository)
      backup_repository_target="${2:?--repository requires a value}"
      shift 2
      ;;
    --apply)
      backup_apply=true
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

case "${backup_repository_target}" in
  internal)
    declare -a retention_arguments=(
      --keep-daily 14
      --keep-weekly 4
    )
    ;;
  primary)
    backup_is_volume_mounted "${backup_primary_volume}" \
      || { backup_die "Volume ${backup_primary_volume} is not mounted"; exit 1; }
    declare -a retention_arguments=(
      --keep-daily 30
      --keep-weekly 13
      --keep-monthly 13
      --keep-yearly 3
    )
    ;;
  secondary)
    backup_is_volume_mounted "${backup_secondary_volume}" \
      || { backup_die "Volume ${backup_secondary_volume} is not mounted"; exit 1; }
    declare -a retention_arguments=(
      --keep-weekly 13
      --keep-monthly 13
      --keep-yearly 3
    )
    ;;
  *)
    backup_die "Unknown repository target: ${backup_repository_target}"
    exit 1
    ;;
esac

maintenance_cleanup() {
  local exit_code=$?

  set +e
  backup_release_lock
  exit "${exit_code}"
}

trap maintenance_cleanup EXIT INT TERM

backup_ensure_support_directories
backup_acquire_lock maintenance
backup_require_command jq
backup_require_command restic

backup_repository_path="$(backup_repository_path_for_target "${backup_repository_target}")"

if [[ ! -f "${backup_repository_path}/config" ]]; then
  backup_die "Repository is not initialized: ${backup_repository_path}"
  exit 1
fi

declare -a forget_arguments=(
  forget
  --host "${backup_host}"
  --tag twenty-complete
  --group-by host
  "${retention_arguments[@]}"
  --json
)

backup_action="dry-run"

if [[ "${backup_apply}" == true ]]; then
  backup_log "Checking repository before retention changes"
  backup_restic "${backup_repository_path}" check >/dev/null
  forget_arguments+=(--prune)
  backup_action="applied"
else
  forget_arguments+=(--dry-run)
fi

backup_retention_result="$(backup_restic "${backup_repository_path}" "${forget_arguments[@]}")"
backup_retention_result_json="$(
  printf '%s\n' "${backup_retention_result}" \
    | jq -s '.'
)"

backup_result_json="$(jq -n \
  --arg status "complete" \
  --arg repository "${backup_repository_target}" \
  --arg repositoryPath "${backup_repository_path}" \
  --arg action "${backup_action}" \
  --arg maintainedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --argjson resticResult "${backup_retention_result_json:-[]}" \
  '{
    status: $status,
    repository: $repository,
    repositoryPath: $repositoryPath,
    action: $action,
    maintainedAt: $maintainedAt,
    resticResult: $resticResult
  }')"

if [[ "${backup_json_output}" == true ]]; then
  printf '%s\n' "${backup_result_json}"
else
  printf '%s\n' "${backup_result_json}" | jq .
fi
