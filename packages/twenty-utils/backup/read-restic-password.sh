#!/bin/bash

set -euo pipefail

backup_keychain_service="${TWENTY_BACKUP_KEYCHAIN_SERVICE:-com.twenty.local-backup.restic}"
backup_keychain_account="$(id -un)"

/usr/bin/security find-generic-password \
  -a "${backup_keychain_account}" \
  -s "${backup_keychain_service}" \
  -w

