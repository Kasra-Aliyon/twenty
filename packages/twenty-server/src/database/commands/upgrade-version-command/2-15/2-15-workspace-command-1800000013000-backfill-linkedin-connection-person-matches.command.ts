import { Command } from 'nest-commander';

import { MoreThan } from 'typeorm';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { LinkedinConnectionMatcherService } from 'src/modules/linkedin/services/linkedin-connection-matcher.service';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';

const CONNECTION_BATCH_SIZE = 500;

@RegisteredWorkspaceCommand('2.15.0', 1800000013000)
@Command({
  name: 'upgrade:2-15:backfill-linkedin-connection-person-matches',
  description:
    'Match harvested LinkedIn connections to Person records so sequence LinkedIn conditions can read them',
})
export class BackfillLinkedinConnectionPersonMatchesCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly linkedinConnectionMatcherService: LinkedinConnectionMatcherService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    if (options.dryRun) {
      const totalCount = await this.countConnections(workspaceId);

      this.logger.log(
        `[DRY RUN] Would attempt to match ${totalCount} LinkedIn connection(s) to Person records for workspace ${workspaceId}`,
      );

      return;
    }

    let processedCount = 0;
    let lastId: string | null = null;

    for (;;) {
      const connectionIds = await this.getConnectionIdsBatch({
        workspaceId,
        afterId: lastId,
      });

      if (connectionIds.length === 0) {
        break;
      }

      await this.linkedinConnectionMatcherService.matchConnectionsByIds({
        connectionIds,
        workspaceId,
      });

      processedCount += connectionIds.length;
      lastId = connectionIds[connectionIds.length - 1];

      if (connectionIds.length < CONNECTION_BATCH_SIZE) {
        break;
      }
    }

    this.logger.log(
      `Attempted to match ${processedCount} LinkedIn connection(s) to Person records for workspace ${workspaceId}`,
    );
  }

  private async countConnections(workspaceId: string): Promise<number> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<LinkedinConnectionWorkspaceEntity>(
            workspaceId,
            'linkedinConnection',
            { shouldBypassPermissionChecks: true },
          );

        return repository.count();
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  private async getConnectionIdsBatch({
    workspaceId,
    afterId,
  }: {
    workspaceId: string;
    afterId: string | null;
  }): Promise<string[]> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<LinkedinConnectionWorkspaceEntity>(
            workspaceId,
            'linkedinConnection',
            { shouldBypassPermissionChecks: true },
          );
        const rows = await repository.find({
          where: afterId ? { id: MoreThan(afterId) } : {},
          order: { id: 'ASC' },
          take: CONNECTION_BATCH_SIZE,
          select: ['id'],
        });

        return rows.map(({ id }) => id);
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
