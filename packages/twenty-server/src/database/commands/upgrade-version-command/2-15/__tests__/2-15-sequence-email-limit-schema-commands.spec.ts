import { type DataSource, type EntityManager, type QueryRunner } from 'typeorm';

import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { AddSequenceEmailLimitsToConnectedAccountFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-instance-command-fast-1800000020500-add-sequence-email-limits-to-connected-account';
import { BackstopSequenceEmailLimitColumnsCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000021000-backstop-sequence-email-limit-columns.command';

describe('2.15 sequence email limit schema commands', () => {
  it('idempotently adds all public limit and private usage fields in the fast command', async () => {
    const query = jest.fn();
    const command =
      new AddSequenceEmailLimitsToConnectedAccountFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls
      .map(([statement]) => statement as string)
      .join('\n');

    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "sequenceDailyEmailLimitEnabled"',
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "sequenceDailyEmailLimit"',
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "sequenceDailyEmailUsageDate" date',
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "sequenceDailyEmailUsageCount" integer',
    );
    expect(sql).toContain(
      "conname = 'CHK_connectedAccount_sequenceDailyEmailLimit_range'",
    );
    expect(sql).toContain(
      "conname = 'CHK_connectedAccount_sequenceDailyEmailUsageCount_nonnegative'",
    );
    expect(sql).toContain(
      '"CHK_connectedAccount_sequenceDailyEmailLimit_range"',
    );
    expect(sql).toContain(
      '"CHK_connectedAccount_sequenceDailyEmailUsageCount_nonnegative"',
    );
  });

  it('safely removes fields that may already be absent during a down migration', async () => {
    const query = jest.fn();
    const command =
      new AddSequenceEmailLimitsToConnectedAccountFastInstanceCommand();

    await command.down({ query } as unknown as QueryRunner);

    const sql = query.mock.calls
      .map(([statement]) => statement as string)
      .join('\n');

    expect(sql).toContain('DROP CONSTRAINT IF EXISTS');
    expect(sql).toContain('DROP COLUMN IF EXISTS');
  });

  it('does not acquire a lock or alter core schema during a dry run', async () => {
    const transaction = jest.fn();
    const command = new BackstopSequenceEmailLimitColumnsCommand(
      {} as WorkspaceIteratorService,
      { transaction } as unknown as DataSource,
    );

    await command.runOnWorkspace({
      workspaceId: 'workspace-id',
      options: { dryRun: true },
      index: 0,
      total: 1,
    });

    expect(transaction).not.toHaveBeenCalled();
  });

  it('serializes the idempotent core-schema backstop and creates missing constraints', async () => {
    const query = jest.fn();
    const transaction = jest.fn(
      async (callback: (entityManager: EntityManager) => Promise<void>) =>
        callback({ query } as unknown as EntityManager),
    );
    const command = new BackstopSequenceEmailLimitColumnsCommand(
      {} as WorkspaceIteratorService,
      { transaction } as unknown as DataSource,
    );

    await command.runOnWorkspace({
      workspaceId: 'workspace-id',
      options: {},
      index: 0,
      total: 1,
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_xact_lock($1::bigint)',
      [1800000021000],
    );

    const alterColumnsSql = query.mock.calls[1][0] as string;
    const addConstraintsSql = query.mock.calls[2][0] as string;

    for (const columnName of [
      'sequenceDailyEmailLimitEnabled',
      'sequenceDailyEmailLimit',
      'sequenceDailyEmailUsageDate',
      'sequenceDailyEmailUsageCount',
    ]) {
      expect(alterColumnsSql).toContain(
        `ADD COLUMN IF NOT EXISTS "${columnName}"`,
      );
    }
    expect(addConstraintsSql).toContain(
      "conname = 'CHK_connectedAccount_sequenceDailyEmailLimit_range'",
    );
    expect(addConstraintsSql).toContain(
      "conname = 'CHK_connectedAccount_sequenceDailyEmailUsageCount_nonnegative'",
    );
    expect(addConstraintsSql).toContain('END;');
    expect(addConstraintsSql).toContain('$command$;');
  });
});
