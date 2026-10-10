import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('production refuses to start when upgrade or cron registration fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twenty-entrypoint-test-'));
  try {
    await writeFile(join(directory, 'psql'), '#!/bin/sh\necho t\n', {
      mode: 0o700,
    });
    await writeFile(
      join(directory, 'yarn'),
      '#!/bin/sh\n[ "$2" != "$FAILING_COMMAND" ]\n',
      { mode: 0o700 },
    );
    for (const command of ['upgrade', 'cron:register:all']) {
      const result = spawnSync(
        'sh',
        ['packages/twenty-docker/twenty/entrypoint.sh', 'echo', 'APP_STARTED'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            FAILING_COMMAND: command,
            FAIL_ON_UPGRADE_ERROR: 'true',
            DISABLE_DB_MIGRATIONS: 'false',
            DISABLE_CRON_JOBS_REGISTRATION: 'false',
            PG_DATABASE_URL: 'postgres://test',
          },
        },
      );
      assert.equal(result.status, 1);
      assert.ok(!result.stdout.includes('APP_STARTED'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
