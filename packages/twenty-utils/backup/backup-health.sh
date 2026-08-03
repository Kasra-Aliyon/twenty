#!/bin/bash

# Trap callbacks are invoked indirectly by bash.
# shellcheck disable=SC2329

set -euo pipefail

backup_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=packages/twenty-utils/backup/backup-common.sh
source "${backup_script_directory}/backup-common.sh"

backup_json_output=false

if [[ "${1:-}" == "--json" ]]; then
  backup_json_output=true
  shift
fi

if [[ $# -gt 0 ]]; then
  backup_die "Unknown option: $1"
  exit 1
fi

backup_require_command jq
backup_require_command node
backup_ensure_support_directories

backup_issues_file="$(mktemp "${TMPDIR:-/tmp}/twenty-backup.health.XXXXXX")"

health_cleanup() {
  local exit_code=$?

  rm -f "${backup_issues_file}"
  exit "${exit_code}"
}

trap health_cleanup EXIT INT TERM

state_age_hours() {
  local state_path="$1"
  local timestamp_expression="$2"

  if [[ ! -f "${state_path}" ]]; then
    printf '%s\n' '-1'
    return 0
  fi

  timestamp="$(jq -r "${timestamp_expression} // empty" "${state_path}" 2>/dev/null || true)"

  if [[ -z "${timestamp}" ]]; then
    printf '%s\n' '-1'
    return 0
  fi

  node -e '
    const timestamp = Date.parse(process.argv[1]);
    if (!Number.isFinite(timestamp)) {
      process.stdout.write("-1");
      process.exit(0);
    }
    process.stdout.write(String(Math.floor((Date.now() - timestamp) / 3600000)));
  ' "${timestamp}"
}

add_issue() {
  local severity="$1"
  local code="$2"
  local message="$3"

  jq -c -n \
    --arg severity "${severity}" \
    --arg code "${code}" \
    --arg message "${message}" \
    '{severity: $severity, code: $code, message: $message}' \
    >>"${backup_issues_file}"
}

backup_internal_age="$(
  state_age_hours \
    "${backup_state_directory}/last-complete-internal.json" \
    '.createdAt'
)"
backup_primary_age="$(
  state_age_hours \
    "${backup_state_directory}/last-complete-primary.json" \
    '.createdAt'
)"
backup_secondary_age="$(
  state_age_hours \
    "${backup_state_directory}/last-complete-secondary.json" \
    '.createdAt'
)"
backup_verification_age="$(
  state_age_hours \
    "${backup_state_directory}/last-verification.json" \
    '.verifiedAt'
)"
backup_restore_test_age="$(
  state_age_hours \
    "${backup_state_directory}/last-restore-test.json" \
    '.restoredAt'
)"

if [[ "${backup_internal_age}" -lt 0 ]]; then
  add_issue critical no-internal-backup "No complete internal recovery snapshot exists"
elif [[ "${backup_internal_age}" -ge 30 ]]; then
  add_issue critical stale-internal-backup "Internal recovery snapshot is ${backup_internal_age} hours old"
fi

if [[ "${backup_require_primary}" == true ]]; then
  if [[ "${backup_primary_age}" -lt 0 ]]; then
    add_issue critical no-primary-backup "No complete snapshot has been written to ${backup_primary_volume}"
  elif [[ "${backup_primary_age}" -ge 30 ]]; then
    add_issue critical stale-primary-backup "Primary external snapshot is ${backup_primary_age} hours old"
  fi
fi

if [[ "${backup_require_secondary}" == true ]]; then
  if [[ "${backup_secondary_age}" -lt 0 ]]; then
    add_issue degraded no-secondary-backup "No offline snapshot has been written to ${backup_secondary_volume}"
  elif [[ "${backup_secondary_age}" -ge 192 ]]; then
    add_issue degraded stale-secondary-backup "Offline snapshot is ${backup_secondary_age} hours old"
  fi
fi

if [[ "${backup_verification_age}" -lt 0 ]]; then
  add_issue degraded no-verification "No repository verification has completed"
elif [[ "${backup_verification_age}" -ge 192 ]]; then
  add_issue critical stale-verification "Repository verification is ${backup_verification_age} hours old"
fi

if [[ "${backup_restore_test_age}" -lt 0 ]]; then
  add_issue degraded no-restore-test "No isolated restore test has completed"
elif [[ "${backup_restore_test_age}" -ge 2400 ]]; then
  add_issue degraded stale-restore-test "Isolated restore test is ${backup_restore_test_age} hours old"
fi

backup_primary_mounted=false
backup_secondary_mounted=false
backup_is_volume_mounted "${backup_primary_volume}" && backup_primary_mounted=true
backup_is_volume_mounted "${backup_secondary_volume}" && backup_secondary_mounted=true

backup_issue_count="$(wc -l <"${backup_issues_file}" | tr -d ' ')"
backup_critical_count="$(jq -s '[.[] | select(.severity == "critical")] | length' "${backup_issues_file}")"
backup_degraded_count="$(jq -s '[.[] | select(.severity == "degraded")] | length' "${backup_issues_file}")"

backup_health_status="healthy"
backup_health_exit_code=0

if [[ "${backup_critical_count}" -gt 0 ]]; then
  backup_health_status="critical"
  backup_health_exit_code=1
elif [[ "${backup_degraded_count}" -gt 0 ]]; then
  backup_health_status="degraded"
  backup_health_exit_code=2
fi

backup_result_json="$(jq -n \
  --arg status "${backup_health_status}" \
  --arg checkedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --argjson internalAgeHours "${backup_internal_age}" \
  --argjson primaryAgeHours "${backup_primary_age}" \
  --argjson secondaryAgeHours "${backup_secondary_age}" \
  --argjson verificationAgeHours "${backup_verification_age}" \
  --argjson restoreTestAgeHours "${backup_restore_test_age}" \
  --argjson primaryMounted "${backup_primary_mounted}" \
  --argjson secondaryMounted "${backup_secondary_mounted}" \
  --argjson issueCount "${backup_issue_count}" \
  --argjson issues "$(jq -s '.' "${backup_issues_file}")" \
  '{
    status: $status,
    checkedAt: $checkedAt,
    agesHours: {
      internal: $internalAgeHours,
      primary: $primaryAgeHours,
      secondary: $secondaryAgeHours,
      verification: $verificationAgeHours,
      restoreTest: $restoreTestAgeHours
    },
    mounted: {
      primary: $primaryMounted,
      secondary: $secondaryMounted
    },
    issueCount: $issueCount,
    issues: $issues
  }')"

printf '%s\n' "${backup_result_json}" >"${backup_state_directory}/health.json.tmp"
mv "${backup_state_directory}/health.json.tmp" "${backup_state_directory}/health.json"

if [[ "${backup_json_output}" == true ]]; then
  printf '%s\n' "${backup_result_json}"
else
  printf '%s\n' "${backup_result_json}" | jq .
fi

exit "${backup_health_exit_code}"
