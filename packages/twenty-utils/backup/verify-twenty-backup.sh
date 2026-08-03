#!/bin/bash

# Trap callbacks are invoked indirectly by bash.
# shellcheck disable=SC2329

set -euo pipefail

backup_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=packages/twenty-utils/backup/backup-common.sh
source "${backup_script_directory}/backup-common.sh"

backup_target_specification="internal"
backup_data_subset=""
backup_json_output=false

usage() {
  cat <<'EOF'
Usage: verify-twenty-backup.sh [options]

Options:
  --target TARGETS
  --data-subset PERCENT_OR_SIZE   Example: 10% or 500M
  --json
  --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      backup_target_specification="${2:?--target requires a value}"
      shift 2
      ;;
    --data-subset)
      backup_data_subset="${2:?--data-subset requires a value}"
      shift 2
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

backup_ensure_support_directories
backup_acquire_lock verify
backup_require_command jq
backup_require_command node
backup_require_command restic

declare -a backup_target_names=()
while IFS= read -r target_name; do
  [[ -n "${target_name}" ]] && backup_target_names+=("${target_name}")
done < <(backup_resolve_repository_lines "${backup_target_specification}")

if [[ ${#backup_target_names[@]} -eq 0 ]]; then
  backup_die "No mounted repositories were selected for verification"
  exit 1
fi

backup_primary_is_mounted=false
backup_secondary_is_mounted=false
backup_external_degraded=false

backup_is_volume_mounted "${backup_primary_volume}" \
  && backup_primary_is_mounted=true
backup_is_volume_mounted "${backup_secondary_volume}" \
  && backup_secondary_is_mounted=true

if [[ "${backup_target_specification}" == *primary-if-mounted* \
  || "${backup_target_specification}" == *all-mounted* ]]; then
  if [[ "${backup_primary_is_mounted}" != true ]]; then
    backup_external_degraded=true
  fi
fi

backup_results_file="$(mktemp "${TMPDIR:-/tmp}/twenty-backup.verify.XXXXXX")"
backup_failed_count=0

verify_cleanup_file() {
  local exit_code=$?

  set +e
  rm -f "${backup_results_file}"
  backup_release_lock
  exit "${exit_code}"
}

trap verify_cleanup_file EXIT INT TERM

for target_name in "${backup_target_names[@]}"; do
  repository_path="$(backup_repository_path_for_target "${target_name}")"

  if [[ ! -f "${repository_path}/config" ]]; then
    jq -n \
      --arg target "${target_name}" \
      --arg repository "${repository_path}" \
      '{target: $target, repository: $repository, status: "failed", reason: "repository-not-initialized"}' \
      >>"${backup_results_file}"
    backup_failed_count=$((backup_failed_count + 1))
    continue
  fi

  declare -a check_arguments=(check)
  if [[ -n "${backup_data_subset}" ]]; then
    check_arguments+=("--read-data-subset=${backup_data_subset}")
  fi

  set +e
  backup_restic "${repository_path}" "${check_arguments[@]}" >/dev/null
  check_exit_code=$?
  set -e

  if [[ ${check_exit_code} -ne 0 ]]; then
    jq -n \
      --arg target "${target_name}" \
      --arg repository "${repository_path}" \
      --argjson exitCode "${check_exit_code}" \
      '{target: $target, repository: $repository, status: "failed", reason: "restic-check", exitCode: $exitCode}' \
      >>"${backup_results_file}"
    backup_failed_count=$((backup_failed_count + 1))
    continue
  fi

  snapshots_json="$(backup_latest_complete_snapshot_json "${repository_path}" || true)"
  snapshot_id="$(printf '%s' "${snapshots_json:-[]}" | jq -r '.[0].short_id // .[0].id // empty')"
  snapshot_time="$(printf '%s' "${snapshots_json:-[]}" | jq -r '.[0].time // empty')"
  snapshot_age_hours="$(backup_snapshot_age_hours "${repository_path}")"

  if [[ -z "${snapshot_id}" ]]; then
    jq -n \
      --arg target "${target_name}" \
      --arg repository "${repository_path}" \
      '{target: $target, repository: $repository, status: "failed", reason: "no-complete-snapshot"}' \
      >>"${backup_results_file}"
    backup_failed_count=$((backup_failed_count + 1))
    continue
  fi

  snapshot_listing="$(backup_restic "${repository_path}" ls "${snapshot_id}" 2>/dev/null)"
  manifest_path="$(
    awk '/\/twenty-recovery\/manifest.json$/ {manifest = $NF} END {print manifest}' \
      <<<"${snapshot_listing}"
  )"

  if [[ -z "${manifest_path}" ]] \
    || ! backup_restic "${repository_path}" dump "${snapshot_id}" "${manifest_path}" \
      | jq -e '.formatVersion == 1 and .complete == true' >/dev/null; then
    jq -n \
      --arg target "${target_name}" \
      --arg repository "${repository_path}" \
      --arg snapshotId "${snapshot_id}" \
      '{target: $target, repository: $repository, snapshotId: $snapshotId, status: "failed", reason: "manifest-validation"}' \
      >>"${backup_results_file}"
    backup_failed_count=$((backup_failed_count + 1))
    continue
  fi

  jq -n \
    --arg target "${target_name}" \
    --arg repository "${repository_path}" \
    --arg snapshotId "${snapshot_id}" \
    --arg snapshotTime "${snapshot_time}" \
    --argjson ageHours "${snapshot_age_hours}" \
    '{
      target: $target,
      repository: $repository,
      status: "complete",
      snapshotId: $snapshotId,
      snapshotTime: $snapshotTime,
      ageHours: $ageHours,
      manifestValidated: true
    }' >>"${backup_results_file}"
done

backup_status="complete"
backup_exit_code=0

if [[ ${backup_failed_count} -gt 0 ]]; then
  backup_status="failed"
  backup_exit_code=1
elif [[ "${backup_external_degraded}" == true ]]; then
  backup_status="degraded"
  backup_exit_code=2
fi

backup_result_json="$(jq -n \
  --arg status "${backup_status}" \
  --arg verifiedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg dataSubset "${backup_data_subset}" \
  --argjson primaryMounted "${backup_primary_is_mounted}" \
  --argjson secondaryMounted "${backup_secondary_is_mounted}" \
  --argjson repositories "$(jq -s '.' "${backup_results_file}")" \
  '{
    status: $status,
    verifiedAt: $verifiedAt,
    dataSubset: (if $dataSubset == "" then null else $dataSubset end),
    externalCoverage: {
      primaryMounted: $primaryMounted,
      secondaryMounted: $secondaryMounted
    },
    repositories: $repositories
  }')"

printf '%s\n' "${backup_result_json}" >"${backup_state_directory}/last-verification.json.tmp"
mv \
  "${backup_state_directory}/last-verification.json.tmp" \
  "${backup_state_directory}/last-verification.json"

if [[ "${backup_json_output}" == true ]]; then
  printf '%s\n' "${backup_result_json}"
else
  printf '%s\n' "${backup_result_json}" | jq .
fi

exit "${backup_exit_code}"
