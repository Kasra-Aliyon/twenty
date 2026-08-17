import { InjectDataSource } from '@nestjs/typeorm';
import { Command } from 'nest-commander';
import { DataSource } from 'typeorm';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';

const SCHEMA_BACKSTOP_ADVISORY_LOCK_KEY = 1800000021000;

@RegisteredWorkspaceCommand('2.15.0', 1800000021000)
@Command({
  name: 'upgrade:2-15:backstop-sequence-email-limit-columns',
  description:
    'Ensure sequence email limit and usage columns exist for installations that already ran the 2.15 fast-command phase',
})
export class BackstopSequenceEmailLimitColumnsCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Would ensure sequence email limit and usage columns exist for workspace ${workspaceId}`,
      );

      return;
    }

    await this.coreDataSource.transaction(async (entityManager) => {
      await entityManager.query('SELECT pg_advisory_xact_lock($1::bigint)', [
        SCHEMA_BACKSTOP_ADVISORY_LOCK_KEY,
      ]);
      await entityManager.query(
        `ALTER TABLE "core"."connectedAccount"
         ADD COLUMN IF NOT EXISTS "sequenceDailyEmailLimitEnabled" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "sequenceDailyEmailLimit" integer NOT NULL DEFAULT 30,
         ADD COLUMN IF NOT EXISTS "sequenceDailyEmailUsageDate" date,
         ADD COLUMN IF NOT EXISTS "sequenceDailyEmailUsageCount" integer NOT NULL DEFAULT 0`,
      );
      await entityManager.query(
        `DO $command$
         BEGIN
           IF NOT EXISTS (
             SELECT 1
             FROM pg_constraint
             WHERE conname = 'CHK_connectedAccount_sequenceDailyEmailLimit_range'
               AND conrelid = '"core"."connectedAccount"'::regclass
           ) THEN
             ALTER TABLE "core"."connectedAccount"
             ADD CONSTRAINT "CHK_connectedAccount_sequenceDailyEmailLimit_range"
             CHECK ("sequenceDailyEmailLimit" BETWEEN 1 AND 200);
           END IF;

           IF NOT EXISTS (
             SELECT 1
             FROM pg_constraint
             WHERE conname = 'CHK_connectedAccount_sequenceDailyEmailUsageCount_nonnegative'
               AND conrelid = '"core"."connectedAccount"'::regclass
           ) THEN
             ALTER TABLE "core"."connectedAccount"
             ADD CONSTRAINT "CHK_connectedAccount_sequenceDailyEmailUsageCount_nonnegative"
             CHECK ("sequenceDailyEmailUsageCount" >= 0);
           END IF;
         END;
         $command$;`,
      );
    });

    this.logger.log(
      `Ensured sequence email limit and usage columns exist for workspace ${workspaceId}`,
    );
  }
}
