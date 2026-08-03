#!/bin/bash

set -euo pipefail

backup_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=packages/twenty-utils/backup/backup-common.sh
source "${backup_script_directory}/backup-common.sh"

backup_repository_target="internal"
backup_snapshot_id="latest"
backup_restore_target=""
backup_verify_database=false
backup_json_output=false
backup_verification_container=""

usage() {
  cat <<'EOF'
Usage: restore-twenty-backup.sh --target-directory ABSOLUTE_PATH [options]

This command restores into a new directory only. It never writes to the live
database, Docker volume, .local-storage directory, or configuration files.

Options:
  --repository internal|primary|secondary
  --snapshot SNAPSHOT_ID             Default: latest complete snapshot
  --target-directory ABSOLUTE_PATH
  --verify-database                  Restore into disposable PostgreSQL 16
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
    --snapshot)
      backup_snapshot_id="${2:?--snapshot requires a value}"
      shift 2
      ;;
    --target-directory)
      backup_restore_target="${2:?--target-directory requires a value}"
      shift 2
      ;;
    --verify-database)
      backup_verify_database=true
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

if [[ -z "${backup_restore_target}" ]]; then
  backup_die "--target-directory is required"
  usage >&2
  exit 1
fi

case "${backup_repository_target}" in
  internal) ;;
  primary)
    backup_is_volume_mounted "${backup_primary_volume}" \
      || { backup_die "Volume ${backup_primary_volume} is not mounted"; exit 1; }
    ;;
  secondary)
    backup_is_volume_mounted "${backup_secondary_volume}" \
      || { backup_die "Volume ${backup_secondary_volume} is not mounted"; exit 1; }
    ;;
  *)
    backup_die "Unknown repository target: ${backup_repository_target}"
    exit 1
    ;;
esac

backup_validate_restore_target "${backup_restore_target}"
backup_ensure_support_directories
backup_acquire_lock restore

restore_cleanup() {
  local exit_code=$?

  set +e
  if [[ -n "${backup_verification_container}" ]]; then
    docker stop "${backup_verification_container}" >/dev/null 2>&1 || true
  fi
  backup_release_lock
  exit "${exit_code}"
}

trap restore_cleanup EXIT INT TERM

backup_require_command jq
backup_require_command restic
backup_require_command shasum

backup_repository_path="$(backup_repository_path_for_target "${backup_repository_target}")"

if [[ ! -f "${backup_repository_path}/config" ]]; then
  backup_die "Repository is not initialized: ${backup_repository_path}"
  exit 1
fi

mkdir -p "${backup_restore_target}"
chmod 700 "${backup_restore_target}"

declare -a restore_arguments=(restore "${backup_snapshot_id}" --target "${backup_restore_target}")
if [[ "${backup_snapshot_id}" == "latest" ]]; then
  restore_arguments+=(--tag twenty-complete)
fi

backup_log "Restoring encrypted snapshot into isolated directory"
backup_restic "${backup_repository_path}" "${restore_arguments[@]}" >/dev/null

backup_manifest_file="$(
  find "${backup_restore_target}" \
    -type f \
    -path '*/twenty-recovery/manifest.json' \
    -print \
    -quit
)"

backup_recovery_root=""
if [[ -n "${backup_manifest_file}" ]]; then
  backup_recovery_root="$(dirname "${backup_manifest_file}")"
fi

if [[ -z "${backup_recovery_root}" ]] \
  || [[ ! -f "${backup_recovery_root}/checksums.sha256" ]]; then
  backup_die "Restored snapshot does not contain a valid Twenty recovery root"
  exit 1
fi

(
  cd "${backup_recovery_root}"
  shasum -a 256 -c checksums.sha256 >/dev/null
)

jq -e '.formatVersion == 1 and .complete == true' \
  "${backup_recovery_root}/manifest.json" >/dev/null

backup_database_verification_status="not-requested"
backup_schema_count=""

if [[ "${backup_verify_database}" == true ]]; then
  backup_require_command docker
  docker info >/dev/null 2>&1 \
    || { backup_die "Docker Desktop is required for database verification"; exit 1; }

  backup_verification_container="twenty-backup-verify-$$"
  backup_log "Restoring dump into disposable PostgreSQL 16 container"

  docker run \
    --detach \
    --rm \
    --name "${backup_verification_container}" \
    --env POSTGRES_PASSWORD=twenty-backup-verify \
    --env POSTGRES_DB=restore_verify \
    postgres:16 >/dev/null

  for attempt in $(seq 1 30); do
    if docker exec "${backup_verification_container}" \
      pg_isready -U postgres -d restore_verify -q; then
      break
    fi

    if [[ "${attempt}" -eq 30 ]]; then
      backup_die "Disposable PostgreSQL container did not become ready"
      exit 1
    fi

    sleep 1
  done

  docker exec -i "${backup_verification_container}" \
    pg_restore \
      -U postgres \
      -d restore_verify \
      --exit-on-error \
    <"${backup_recovery_root}/database/default.dump" >/dev/null

  backup_schema_count="$(
    docker exec "${backup_verification_container}" \
      psql -At -U postgres -d restore_verify \
        -c "SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'"
  )"

  docker exec "${backup_verification_container}" \
    psql -At -U postgres -d restore_verify \
      -c "SELECT 1 FROM pg_namespace WHERE nspname = 'core'" \
    | grep -q '^1$'

  backup_database_verification_status="complete"
  docker stop "${backup_verification_container}" >/dev/null
  backup_verification_container=""
fi

backup_result_json="$(jq -n \
  --arg status "complete" \
  --arg restoredAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg repository "${backup_repository_target}" \
  --arg snapshot "${backup_snapshot_id}" \
  --arg targetDirectory "${backup_restore_target}" \
  --arg recoveryRoot "${backup_recovery_root}" \
  --arg databaseVerification "${backup_database_verification_status}" \
  --arg schemaCount "${backup_schema_count}" \
  '{
    status: $status,
    restoredAt: $restoredAt,
    repository: $repository,
    snapshot: $snapshot,
    targetDirectory: $targetDirectory,
    recoveryRoot: $recoveryRoot,
    checksumsVerified: true,
    manifestVerified: true,
    databaseVerification: $databaseVerification,
    restoredSchemaCount: (if $schemaCount == "" then null else ($schemaCount | tonumber) end)
  }')"

printf '%s\n' "${backup_result_json}" >"${backup_state_directory}/last-restore-test.json.tmp"
mv \
  "${backup_state_directory}/last-restore-test.json.tmp" \
  "${backup_state_directory}/last-restore-test.json"

if [[ "${backup_json_output}" == true ]]; then
  printf '%s\n' "${backup_result_json}"
else
  printf '%s\n' "${backup_result_json}" | jq .
fi
