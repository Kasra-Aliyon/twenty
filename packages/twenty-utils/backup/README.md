# Twenty local backup system

This subsystem creates encrypted, local-only recovery snapshots for the complete
Twenty development installation. It does not use cloud storage.

The active backup folder is:

```text
~/Library/Application Support/Twenty Backup/repositories/internal
```

The scheduled system uses only this folder. External drives are optional and
are not required for a healthy folder-only installation.

## First-time setup

```bash
cd /Users/kasraaliyon/Documents/GitHub/twenty
brew install restic shellcheck
bash packages/twenty-utils/backup/setup-twenty-backup.sh --json
```

The setup command:

- creates an encrypted internal restic repository;
- creates a random restic password in macOS Keychain.

Read the recovery-key instructions immediately:

```bash
open "$HOME/Library/Application Support/Twenty Backup/RECOVERY-KEY-INSTRUCTIONS.txt"
```

Store the password outside the Mac. Losing the Keychain item and the offline copy
makes the encrypted snapshots unrecoverable.

## Run and check now

```bash
bash packages/twenty-utils/backup/run-twenty-backup.sh \
  --mode online \
  --target internal \
  --json

bash packages/twenty-utils/backup/verify-twenty-backup.sh \
  --target internal \
  --data-subset 10% \
  --json

bash packages/twenty-utils/backup/backup-health.sh --json
```

Status meanings:

- `complete` / exit 0: all selected targets succeeded.
- `degraded` / exit 2: the complete internal snapshot exists, but expected
  external coverage is missing or another selected repository failed.
- `partial` / exit 3: a snapshot was retained, but it is not a complete recovery
  set and does not advance the complete-backup timestamp.
- `failed` / exit 1: no usable complete snapshot was created.

## Optional external media

You can ignore this section for the normal folder-only setup. It exists only if
you later decide that a second physical disk should protect against loss of the
Mac's internal disk.

Use encrypted APFS volumes named exactly:

```text
TWENTY_BACKUP_A
TWENTY_BACKUP_B
```

The scripts verify that these names are real mount points and will not create
similarly named directories on the Mac's internal disk. Drive A is the connected
daily backup. Drive B is the periodically connected offline copy.

When a drive is first connected:

```bash
bash packages/twenty-utils/backup/setup-twenty-backup.sh --json
```

To initialize mounted external repositories, add `--initialize-external`.

No script formats or erases a drive.

## What is included

Every recovery snapshot includes:

- PostgreSQL `default` custom-format dump using the PostgreSQL 16 container;
- PostgreSQL roles and global definitions;
- Redis RDB state;
- the entire `.local-storage` attachment tree;
- backend and frontend environment files;
- local launcher, Cloudflare, and Twenty LaunchAgent configuration when present;
- exact Git commit and remotes, working-tree and staged binary patches, and
  untracked files;
- component checksums and a versioned manifest.

Redis is recovery evidence, not an automatic restore input. It can contain queued
external actions and must be inspected before workers are started.

Daily snapshots include the exact commit, patches, remotes, and untracked files.
The larger full Git-history bundle is added by the weekly/offline job so it is
not regenerated twice per day.

## Quiesced snapshot

For the strongest database/filesystem/Redis consistency, close Twenty first and
run:

```bash
bash packages/twenty-utils/backup/run-twenty-backup.sh \
  --mode quiesced \
  --target internal \
  --json
```

Quiesced mode refuses to run if ports 2000 or 2001 are open. It never kills Node
processes or restarts the application automatically.

## Restore and prove it

Restore into a new empty directory only:

```bash
restore_directory="$(mktemp -d /tmp/twenty-restore.XXXXXX)"

bash packages/twenty-utils/backup/restore-twenty-backup.sh \
  --repository internal \
  --snapshot latest \
  --target-directory "$restore_directory" \
  --verify-database \
  --json
```

`--verify-database` starts a disposable PostgreSQL 16 container, restores the
dump, checks the `core` schema, and removes the container. It never connects to
or overwrites the live `default` database.

The monthly scheduled restore test runs the same process automatically.

## Retention

Retention is always a dry run unless `--apply` is explicitly supplied:

```bash
bash packages/twenty-utils/backup/maintain-twenty-backup.sh \
  --repository internal \
  --json

bash packages/twenty-utils/backup/maintain-twenty-backup.sh \
  --repository internal \
  --apply \
  --json
```

Policies:

- internal: 14 daily and 4 weekly;
- primary: 30 daily, 13 weekly, 13 monthly, and 3 yearly;
- secondary: 13 weekly, 13 monthly, and 3 yearly.

Apply retention to one repository at a time. The command runs `restic check`
before a destructive prune. The monthly Codex retention task additionally
verifies a 10% data sample before applying each mounted repository's policy.

## Schedules and logs

This installation is scheduled through local Codex automations. Raw macOS
LaunchAgents cannot enter a repository under `~/Documents` unless `/bin/bash`
is granted broad disk access, so they are deliberately not the active scheduler.
The active Codex tasks are:

- Daily catch-up: 13:00 and 19:00.
- Full local snapshot with Git history: Sunday 11:00.
- Repository verification: Sunday 14:00.
- Isolated restore test: the first day of every month at 15:00.
- Verified retention maintenance: the second day of every month at 16:00.
- Backup health audit: daily at 20:00.

The Codex tasks run locally against this checkout and notify on failed runs.
They do not use cloud or network storage.

Logs:

```text
~/Library/Logs/Twenty Backup/
```

State and machine-readable reports:

```text
~/Library/Application Support/Twenty Backup/state/
```

## Safety checks

```bash
bash -n packages/twenty-utils/backup/*.sh
shellcheck -x -P packages/twenty-utils/backup \
  packages/twenty-utils/backup/*.sh
bash packages/twenty-utils/backup/test-backup-safety.sh
```

The restore command rejects `/`, the home directory, repository root, backup
support directory, live `.local-storage`, and any non-empty target directory.
