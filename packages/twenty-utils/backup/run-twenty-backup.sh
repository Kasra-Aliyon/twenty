#!/bin/bash

# Trap callbacks are invoked indirectly by bash.
# shellcheck disable=SC2329

set -euo pipefail

backup_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=packages/twenty-utils/backup/backup-common.sh
source "${backup_script_directory}/backup-common.sh"

backup_mode="online"
backup_target_specification="internal"
backup_max_age_hours=0
backup_json_output=false
backup_dry_run=false
backup_include_git_bundle=false

backup_staging_directory=""
backup_redis_temporary_path=""
backup_redis_container_id=""
backup_database_was_started=false
backup_redis_was_started=false

usage() {
  cat <<'EOF'
Usage: run-twenty-backup.sh [options]

Options:
  --mode online|quiesced|catch-up
  --target TARGETS
      Selectors: internal, primary, secondary, primary-if-mounted,
      secondary-if-mounted, all-mounted.
  --max-age-hours HOURS
      In catch-up mode, skip when every selected repository is fresh.
  --json
  --dry-run
  --include-git-bundle
  --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      backup_mode="${2:?--mode requires a value}"
      shift 2
      ;;
    --target)
      backup_target_specification="${2:?--target requires a value}"
      shift 2
      ;;
    --max-age-hours)
      backup_max_age_hours="${2:?--max-age-hours requires a value}"
      shift 2
      ;;
    --json)
      backup_json_output=true
      shift
      ;;
    --dry-run)
      backup_dry_run=true
      shift
      ;;
    --include-git-bundle)
      backup_include_git_bundle=true
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

case "${backup_mode}" in
  online|quiesced|catch-up) ;;
  *)
    backup_die "Unsupported backup mode: ${backup_mode}"
    exit 1
    ;;
esac

[[ "${backup_max_age_hours}" =~ ^[0-9]+$ ]] \
  || { backup_die "--max-age-hours must be a non-negative integer"; exit 1; }

backup_cleanup() {
  local exit_code=$?

  set +e

  if [[ -n "${backup_redis_container_id}" ]] \
    && [[ -n "${backup_redis_temporary_path}" ]]; then
    docker exec "${backup_redis_container_id}" \
      rm -f "${backup_redis_temporary_path}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${backup_staging_directory}" ]]; then
    backup_safe_remove_staging_directory "${backup_staging_directory}"
  fi

  if [[ "${backup_redis_was_started}" == true ]]; then
    docker compose -f "${backup_compose_file}" stop redis >/dev/null 2>&1 || true
  fi

  if [[ "${backup_database_was_started}" == true ]]; then
    docker compose -f "${backup_compose_file}" stop db >/dev/null 2>&1 || true
  fi

  backup_release_lock
  exit "${exit_code}"
}

trap backup_cleanup EXIT INT TERM

backup_ensure_support_directories
backup_acquire_lock backup

backup_require_command jq
backup_require_command node
backup_require_command restic
backup_require_command shasum
backup_require_command stat

declare -a backup_target_names=()
while IFS= read -r target_name; do
  [[ -n "${target_name}" ]] && backup_target_names+=("${target_name}")
done < <(backup_resolve_repository_lines "${backup_target_specification}")

if [[ ${#backup_target_names[@]} -eq 0 ]]; then
  backup_die "No usable backup repositories were selected"
  exit 1
fi

backup_primary_is_mounted=false
backup_secondary_is_mounted=false
backup_external_degraded=false

if backup_is_volume_mounted "${backup_primary_volume}"; then
  backup_primary_is_mounted=true
fi

if backup_is_volume_mounted "${backup_secondary_volume}"; then
  backup_secondary_is_mounted=true
fi

if [[ "${backup_target_specification}" == *primary-if-mounted* \
  || "${backup_target_specification}" == *all-mounted* ]]; then
  if [[ "${backup_primary_is_mounted}" != true ]]; then
    backup_external_degraded=true
  fi
fi

if [[ "${backup_dry_run}" == true ]]; then
  jq -n \
    --arg mode "${backup_mode}" \
    --arg targetSpecification "${backup_target_specification}" \
    --arg internalRepository "${backup_internal_repository}" \
    --arg primaryVolume "${backup_primary_volume}" \
    --arg secondaryVolume "${backup_secondary_volume}" \
    --arg database "${backup_database_name}" \
    --arg storagePath "${backup_storage_path}" \
    --argjson primaryMounted "${backup_primary_is_mounted}" \
    --argjson secondaryMounted "${backup_secondary_is_mounted}" \
    --argjson resolvedTargets "$(printf '%s\n' "${backup_target_names[@]}" | jq -R . | jq -s .)" \
    '{
      status: "dry-run",
      mode: $mode,
      targetSpecification: $targetSpecification,
      resolvedTargets: $resolvedTargets,
      internalRepository: $internalRepository,
      primaryVolume: {name: $primaryVolume, mounted: $primaryMounted},
      secondaryVolume: {name: $secondaryVolume, mounted: $secondaryMounted},
      database: $database,
      storagePath: $storagePath
    }'
  exit 0
fi

backup_all_selected_repositories_are_fresh=true

if [[ "${backup_mode}" == "catch-up" && ${backup_max_age_hours} -gt 0 ]]; then
  for target_name in "${backup_target_names[@]}"; do
    repository_path="$(backup_repository_path_for_target "${target_name}")"

    if [[ ! -f "${repository_path}/config" ]]; then
      backup_all_selected_repositories_are_fresh=false
      continue
    fi

    snapshot_age_hours="$(backup_snapshot_age_hours "${repository_path}")"

    if [[ "${snapshot_age_hours}" -lt 0 \
      || "${snapshot_age_hours}" -ge "${backup_max_age_hours}" ]]; then
      backup_all_selected_repositories_are_fresh=false
    fi
  done

  if [[ "${backup_all_selected_repositories_are_fresh}" == true ]]; then
    fresh_status="fresh"
    fresh_exit_code=0

    if [[ "${backup_external_degraded}" == true ]]; then
      fresh_status="degraded"
      fresh_exit_code=2
    fi

    fresh_result="$(jq -n \
      --arg status "${fresh_status}" \
      --arg mode "${backup_mode}" \
      --arg message "All selected repositories already have a complete snapshot newer than ${backup_max_age_hours} hours" \
      --argjson primaryMounted "${backup_primary_is_mounted}" \
      --argjson secondaryMounted "${backup_secondary_is_mounted}" \
      '{
        status: $status,
        mode: $mode,
        skipped: true,
        message: $message,
        externalCoverage: {
          primaryMounted: $primaryMounted,
          secondaryMounted: $secondaryMounted
        }
      }')"

    printf '%s\n' "${fresh_result}" >"${backup_state_directory}/last-run.json.tmp"
    mv "${backup_state_directory}/last-run.json.tmp" "${backup_state_directory}/last-run.json"
    printf '%s\n' "${fresh_result}"
    exit "${fresh_exit_code}"
  fi
fi

backup_require_command docker
backup_require_command git
backup_require_command tar

if [[ "${backup_mode}" == "quiesced" ]]; then
  if /usr/bin/nc -z 127.0.0.1 2000 >/dev/null 2>&1 \
    || /usr/bin/nc -z 127.0.0.1 2001 >/dev/null 2>&1; then
    backup_die "Quiesced mode requires the Twenty backend and frontend to be stopped first"
    exit 1
  fi
fi

docker info >/dev/null 2>&1 \
  || { backup_die "Docker Desktop is not available"; exit 1; }

if [[ -z "$(docker compose -f "${backup_compose_file}" ps -q db 2>/dev/null)" ]]; then
  backup_log "Starting the PostgreSQL service for backup"
  docker compose -f "${backup_compose_file}" up -d db >/dev/null
  backup_database_was_started=true
fi

if [[ -z "$(docker compose -f "${backup_compose_file}" ps -q redis 2>/dev/null)" ]]; then
  backup_log "Starting the Redis service for backup"
  docker compose -f "${backup_compose_file}" up -d redis >/dev/null
  backup_redis_was_started=true
fi

for attempt in $(seq 1 30); do
  if docker compose -f "${backup_compose_file}" exec -T db \
    pg_isready -U "${backup_database_user}" -d "${backup_database_name}" -q; then
    break
  fi

  if [[ "${attempt}" -eq 30 ]]; then
    backup_die "PostgreSQL did not become ready"
    exit 1
  fi

  sleep 1
done

for attempt in $(seq 1 30); do
  if docker compose -f "${backup_compose_file}" exec -T redis \
    redis-cli ping 2>/dev/null | grep -q PONG; then
    break
  fi

  if [[ "${attempt}" -eq 30 ]]; then
    backup_die "Redis did not become ready"
    exit 1
  fi

  sleep 1
done

backup_run_id="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
backup_temporary_root="${TMPDIR:-/tmp}"
backup_temporary_root="${backup_temporary_root%/}"
backup_staging_directory="$(mktemp -d "${backup_temporary_root}/twenty-backup.XXXXXX")"
chmod 700 "${backup_staging_directory}"
backup_snapshot_root="${backup_staging_directory}/twenty-recovery"

mkdir -p \
  "${backup_snapshot_root}/database" \
  "${backup_snapshot_root}/redis" \
  "${backup_snapshot_root}/storage" \
  "${backup_snapshot_root}/configuration" \
  "${backup_snapshot_root}/source" \
  "${backup_snapshot_root}/recovery"

chmod -R go-rwx "${backup_snapshot_root}"

backup_log "Creating PostgreSQL custom-format dump"
docker compose -f "${backup_compose_file}" exec -T db \
  pg_dump \
    -U "${backup_database_user}" \
    -d "${backup_database_name}" \
    --format=custom \
    --compress=6 \
    --no-password \
  >"${backup_snapshot_root}/database/default.dump"

docker compose -f "${backup_compose_file}" exec -T db \
  pg_dumpall \
    -U "${backup_database_user}" \
    --globals-only \
    --no-password \
  >"${backup_snapshot_root}/database/globals.sql"

docker compose -f "${backup_compose_file}" exec -T db \
  pg_restore --list \
  <"${backup_snapshot_root}/database/default.dump" \
  >"${backup_snapshot_root}/database/restore-list.txt"

if [[ ! -s "${backup_snapshot_root}/database/default.dump" ]] \
  || ! grep -Eq 'SCHEMA.*core|SCHEMA - core' "${backup_snapshot_root}/database/restore-list.txt"; then
  backup_die "PostgreSQL archive validation failed"
  exit 1
fi

backup_postgres_version="$(
  docker compose -f "${backup_compose_file}" exec -T db \
    psql -At -U "${backup_database_user}" -d "${backup_database_name}" \
      -c 'SHOW server_version'
)"

backup_schema_count="$(
  docker compose -f "${backup_compose_file}" exec -T db \
    psql -At -U "${backup_database_user}" -d "${backup_database_name}" \
      -c "SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'"
)"

backup_log "Creating Redis RDB snapshot"
backup_redis_container_id="$(
  docker compose -f "${backup_compose_file}" ps -q redis
)"
backup_redis_temporary_path="/tmp/twenty-backup-${backup_run_id}.rdb"

docker exec "${backup_redis_container_id}" \
  redis-cli --rdb "${backup_redis_temporary_path}" >/dev/null
docker cp \
  "${backup_redis_container_id}:${backup_redis_temporary_path}" \
  "${backup_snapshot_root}/redis/dump.rdb" >/dev/null
docker exec "${backup_redis_container_id}" \
  redis-cli INFO server \
  >"${backup_snapshot_root}/redis/server-info.txt"
docker exec "${backup_redis_container_id}" \
  rm -f "${backup_redis_temporary_path}"
backup_redis_temporary_path=""

if [[ ! -s "${backup_snapshot_root}/redis/dump.rdb" ]]; then
  backup_die "Redis snapshot validation failed"
  exit 1
fi

backup_storage_consistent=true
backup_storage_file_count=0
backup_storage_size_bytes=0

storage_fingerprint() {
  find "${backup_storage_path}" -type f \
    -exec stat -f '%N|%z|%m' {} \; \
    | LC_ALL=C sort \
    | shasum -a 256 \
    | awk '{print $1}'
}

if [[ -d "${backup_storage_path}" ]]; then
  backup_log "Capturing Twenty local file storage"

  for storage_attempt in 1 2; do
    storage_fingerprint_before="$(storage_fingerprint)"
    tar \
      -C "$(dirname "${backup_storage_path}")" \
      -cf "${backup_snapshot_root}/storage/local-storage.tar" \
      "$(basename "${backup_storage_path}")"
    storage_fingerprint_after="$(storage_fingerprint)"

    if [[ "${storage_fingerprint_before}" == "${storage_fingerprint_after}" ]]; then
      backup_storage_consistent=true
      break
    fi

    backup_storage_consistent=false
    backup_warn "Local storage changed during capture attempt ${storage_attempt}"
  done

  backup_storage_file_count="$(find "${backup_storage_path}" -type f | wc -l | tr -d ' ')"
  backup_storage_size_bytes="$(
    find "${backup_storage_path}" -type f -exec stat -f '%z' {} \; \
      | awk '{total += $1} END {print total + 0}'
  )"
else
  backup_warn "Twenty local storage directory does not exist: ${backup_storage_path}"
  tar -cf "${backup_snapshot_root}/storage/local-storage.tar" --files-from /dev/null
fi

backup_log "Capturing encrypted recovery configuration"
if [[ -f "${backup_repository_root}/packages/twenty-server/.env" ]]; then
  cp -p \
    "${backup_repository_root}/packages/twenty-server/.env" \
    "${backup_snapshot_root}/configuration/twenty-server.env"
fi

if [[ -f "${backup_repository_root}/packages/twenty-front/.env" ]]; then
  cp -p \
    "${backup_repository_root}/packages/twenty-front/.env" \
    "${backup_snapshot_root}/configuration/twenty-front.env"
fi

cp -p \
  "${backup_compose_file}" \
  "${backup_snapshot_root}/configuration/docker-compose.dev.yml"
cp -R \
  "${backup_script_directory}" \
  "${backup_snapshot_root}/configuration/backup-system"

backup_local_operations_list="${backup_staging_directory}/local-operations-paths.txt"
: >"${backup_local_operations_list}"

backup_launcher_path="${backup_user_home}/Desktop/Twenty CRM.app/Contents/Resources/start-twenty.command"
if [[ -f "${backup_launcher_path}" ]]; then
  printf '%s\n' "${backup_launcher_path}" >>"${backup_local_operations_list}"
fi

if [[ -d "${backup_user_home}/.cloudflared" ]]; then
  printf '%s\n' "${backup_user_home}/.cloudflared" >>"${backup_local_operations_list}"
fi

find "${backup_user_home}/Library/LaunchAgents" \
  -maxdepth 1 \
  -type f \
  -name 'com.twenty*.plist' \
  -print 2>/dev/null \
  >>"${backup_local_operations_list}" || true

if [[ -s "${backup_local_operations_list}" ]]; then
  tar -cf \
    "${backup_snapshot_root}/configuration/local-operations.tar" \
    -T "${backup_local_operations_list}"
else
  tar -cf \
    "${backup_snapshot_root}/configuration/local-operations.tar" \
    --files-from /dev/null
fi

chmod -R go-rwx "${backup_snapshot_root}/configuration"

backup_log "Capturing Git repository and uncommitted source state"
if [[ "${backup_include_git_bundle}" == true ]]; then
  backup_log "Including a full Git bundle for offline source recovery"
  git -C "${backup_repository_root}" bundle create \
    "${backup_snapshot_root}/source/repository.bundle" --all
fi

git -C "${backup_repository_root}" remote -v \
  >"${backup_snapshot_root}/source/remotes.txt"
git -C "${backup_repository_root}" diff --binary \
  >"${backup_snapshot_root}/source/working-tree.patch"
git -C "${backup_repository_root}" diff --cached --binary \
  >"${backup_snapshot_root}/source/staged.patch"
git -C "${backup_repository_root}" status --porcelain=v1 \
  >"${backup_snapshot_root}/source/status.txt"

backup_untracked_list="${backup_staging_directory}/untracked-files.list"
git -C "${backup_repository_root}" ls-files \
  --others \
  --exclude-standard \
  -z \
  >"${backup_untracked_list}"

if [[ -s "${backup_untracked_list}" ]]; then
  (
    cd "${backup_repository_root}"
    tar --null \
      -T "${backup_untracked_list}" \
      -cf "${backup_snapshot_root}/source/untracked-files.tar"
  )
else
  tar -cf "${backup_snapshot_root}/source/untracked-files.tar" --files-from /dev/null
fi

backup_git_commit="$(git -C "${backup_repository_root}" rev-parse HEAD)"
backup_git_branch="$(git -C "${backup_repository_root}" branch --show-current)"
backup_git_change_count="$(wc -l <"${backup_snapshot_root}/source/status.txt" | tr -d ' ')"

printf '%s\n' '1' >"${backup_snapshot_root}/recovery/backup-format-version"
cat >"${backup_snapshot_root}/recovery/restore-warning.txt" <<'EOF'
Never restore this snapshot directly over the live Twenty database or file storage.
Restore into an isolated PostgreSQL 16 container first. Redis is optional recovery
state and may contain queued external actions; do not start workers until inspected.
EOF

backup_database_dump_size="$(stat -f '%z' "${backup_snapshot_root}/database/default.dump")"
backup_redis_dump_size="$(stat -f '%z' "${backup_snapshot_root}/redis/dump.rdb")"
backup_created_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
backup_is_complete="${backup_storage_consistent}"

jq -n \
  --arg createdAt "${backup_created_at}" \
  --arg runId "${backup_run_id}" \
  --arg mode "${backup_mode}" \
  --arg host "${backup_host}" \
  --arg database "${backup_database_name}" \
  --arg databaseUser "${backup_database_user}" \
  --arg postgresVersion "${backup_postgres_version}" \
  --arg gitCommit "${backup_git_commit}" \
  --arg gitBranch "${backup_git_branch}" \
  --arg storagePath "${backup_storage_path}" \
  --argjson complete "${backup_is_complete}" \
  --argjson gitBundleIncluded "${backup_include_git_bundle}" \
  --argjson databaseDumpBytes "${backup_database_dump_size}" \
  --argjson redisDumpBytes "${backup_redis_dump_size}" \
  --argjson schemaCount "${backup_schema_count}" \
  --argjson storageConsistent "${backup_storage_consistent}" \
  --argjson storageFileCount "${backup_storage_file_count}" \
  --argjson storageBytes "${backup_storage_size_bytes}" \
  --argjson gitChangeCount "${backup_git_change_count}" \
  '{
    formatVersion: 1,
    createdAt: $createdAt,
    runId: $runId,
    mode: $mode,
    host: $host,
    complete: $complete,
    database: {
      name: $database,
      user: $databaseUser,
      postgresVersion: $postgresVersion,
      dumpBytes: $databaseDumpBytes,
      schemaCount: $schemaCount,
      format: "pg_dump-custom"
    },
    redis: {
      included: true,
      dumpBytes: $redisDumpBytes,
      restorePolicy: "inspect-before-restore"
    },
    fileStorage: {
      sourcePath: $storagePath,
      consistent: $storageConsistent,
      fileCount: $storageFileCount,
      bytes: $storageBytes
    },
    source: {
      gitCommit: $gitCommit,
      gitBranch: $gitBranch,
      workingTreeChangeCount: $gitChangeCount,
      gitBundleIncluded: $gitBundleIncluded,
      untrackedFilesIncluded: true
    },
    configuration: {
      encryptedByRepository: true,
      serverEnvironmentIncluded: true,
      frontendEnvironmentIncluded: true,
      localOperationsIncluded: true
    }
  }' >"${backup_snapshot_root}/manifest.json"

backup_checksums_temporary="${backup_staging_directory}/checksums.sha256"
(
  cd "${backup_snapshot_root}"
  find . -type f ! -name checksums.sha256 \
    -exec shasum -a 256 {} \; \
    >"${backup_checksums_temporary}"
  mv "${backup_checksums_temporary}" checksums.sha256
  shasum -a 256 -c checksums.sha256 >/dev/null
)

backup_target_results_file="${backup_staging_directory}/target-results.ndjson"
: >"${backup_target_results_file}"
backup_successful_target_count=0
backup_failed_target_count=0

for target_name in "${backup_target_names[@]}"; do
  repository_path="$(backup_repository_path_for_target "${target_name}")"
  restic_report_path="${backup_staging_directory}/restic-${target_name}.ndjson"
  restic_snapshot_tag="twenty-complete"

  if [[ "${backup_is_complete}" != true ]]; then
    restic_snapshot_tag="twenty-partial"
  fi

  backup_log "Saving encrypted snapshot to ${target_name} repository"

  set +e
  backup_initialize_repository "${repository_path}"
  repository_initialization_exit_code=$?
  set -e

  if [[ ${repository_initialization_exit_code} -ne 0 ]]; then
    jq -n \
      --arg target "${target_name}" \
      --arg repository "${repository_path}" \
      '{target: $target, repository: $repository, status: "failed", stage: "repository-initialization"}' \
      >>"${backup_target_results_file}"
    backup_failed_target_count=$((backup_failed_target_count + 1))
    continue
  fi

  set +e
  backup_restic "${repository_path}" backup \
    "${backup_snapshot_root}" \
    --host "${backup_host}" \
    --tag twenty \
    --tag "${restic_snapshot_tag}" \
    --tag "mode-${backup_mode}" \
    --tag "target-${target_name}" \
    --json \
    >"${restic_report_path}"
  restic_backup_exit_code=$?
  set -e

  restic_snapshot_id="$(
    jq -rs '[.[] | select(.message_type == "summary")][-1].snapshot_id // empty' \
      "${restic_report_path}" 2>/dev/null || true
  )"

  if [[ ${restic_backup_exit_code} -ne 0 || -z "${restic_snapshot_id}" ]]; then
    jq -n \
      --arg target "${target_name}" \
      --arg repository "${repository_path}" \
      --argjson exitCode "${restic_backup_exit_code}" \
      '{target: $target, repository: $repository, status: "failed", stage: "backup", exitCode: $exitCode}' \
      >>"${backup_target_results_file}"
    backup_failed_target_count=$((backup_failed_target_count + 1))
    continue
  fi

  restic_snapshot_listing="$(
    backup_restic "${repository_path}" ls "${restic_snapshot_id}"
  )"

  if ! grep -q '/twenty-recovery/manifest.json$' \
    <<<"${restic_snapshot_listing}"; then
    jq -n \
      --arg target "${target_name}" \
      --arg repository "${repository_path}" \
      --arg snapshotId "${restic_snapshot_id}" \
      '{target: $target, repository: $repository, status: "failed", stage: "post-backup-verification", snapshotId: $snapshotId}' \
      >>"${backup_target_results_file}"
    backup_failed_target_count=$((backup_failed_target_count + 1))
    continue
  fi

  jq -n \
    --arg target "${target_name}" \
    --arg repository "${repository_path}" \
    --arg snapshotId "${restic_snapshot_id}" \
    '{target: $target, repository: $repository, status: "complete", snapshotId: $snapshotId}' \
    >>"${backup_target_results_file}"
  backup_successful_target_count=$((backup_successful_target_count + 1))
done

backup_result_status="complete"
backup_result_exit_code=0

if [[ ${backup_successful_target_count} -eq 0 ]]; then
  backup_result_status="failed"
  backup_result_exit_code=1
elif [[ "${backup_is_complete}" != true ]]; then
  backup_result_status="partial"
  backup_result_exit_code=3
elif [[ ${backup_failed_target_count} -gt 0 \
  || "${backup_external_degraded}" == true ]]; then
  backup_result_status="degraded"
  backup_result_exit_code=2
fi

backup_target_results_json="$(jq -s '.' "${backup_target_results_file}")"
backup_result_json="$(jq -n \
  --arg status "${backup_result_status}" \
  --arg createdAt "${backup_created_at}" \
  --arg runId "${backup_run_id}" \
  --arg mode "${backup_mode}" \
  --arg database "${backup_database_name}" \
  --arg primaryVolume "${backup_primary_volume}" \
  --arg secondaryVolume "${backup_secondary_volume}" \
  --argjson complete "${backup_is_complete}" \
  --argjson databaseDumpBytes "${backup_database_dump_size}" \
  --argjson redisDumpBytes "${backup_redis_dump_size}" \
  --argjson storageFileCount "${backup_storage_file_count}" \
  --argjson storageBytes "${backup_storage_size_bytes}" \
  --argjson primaryMounted "${backup_primary_is_mounted}" \
  --argjson secondaryMounted "${backup_secondary_is_mounted}" \
  --argjson targets "${backup_target_results_json}" \
  '{
    status: $status,
    createdAt: $createdAt,
    runId: $runId,
    mode: $mode,
    complete: $complete,
    database: {name: $database, dumpBytes: $databaseDumpBytes},
    redis: {dumpBytes: $redisDumpBytes},
    fileStorage: {fileCount: $storageFileCount, bytes: $storageBytes},
    externalCoverage: {
      primaryVolume: $primaryVolume,
      primaryMounted: $primaryMounted,
      secondaryVolume: $secondaryVolume,
      secondaryMounted: $secondaryMounted
    },
    targets: $targets
  }')"

printf '%s\n' "${backup_result_json}" >"${backup_state_directory}/last-run.json.tmp"
mv "${backup_state_directory}/last-run.json.tmp" "${backup_state_directory}/last-run.json"

if [[ "${backup_is_complete}" == true \
  && ${backup_successful_target_count} -gt 0 ]]; then
  printf '%s\n' "${backup_result_json}" >"${backup_state_directory}/last-complete.json.tmp"
  mv \
    "${backup_state_directory}/last-complete.json.tmp" \
    "${backup_state_directory}/last-complete.json"

  while IFS= read -r successful_target; do
    successful_target_name="$(printf '%s' "${successful_target}" | jq -r '.target')"
    jq -n \
      --arg createdAt "${backup_created_at}" \
      --argjson target "${successful_target}" \
      '{createdAt: $createdAt, target: $target}' \
      >"${backup_state_directory}/last-complete-${successful_target_name}.json.tmp"
    mv \
      "${backup_state_directory}/last-complete-${successful_target_name}.json.tmp" \
      "${backup_state_directory}/last-complete-${successful_target_name}.json"
  done < <(jq -c 'select(.status == "complete")' "${backup_target_results_file}")
fi

if [[ "${backup_json_output}" == true ]]; then
  printf '%s\n' "${backup_result_json}"
else
  printf '%s\n' "${backup_result_json}" | jq .
fi

exit "${backup_result_exit_code}"
