import { Command } from 'nest-commander';

import { MoreThan } from 'typeorm';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { LinkedinParticipantMatcherService } from 'src/modules/linkedin/services/linkedin-participant-matcher.service';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';

const PARTICIPANT_BATCH_SIZE = 500;

@RegisteredWorkspaceCommand('2.15.0', 1800000015000)
@Command({
  name: 'upgrade:2-15:backfill-linkedin-participant-person-matches',
  description:
    'Match harvested LinkedIn thread participants to Person records so inbound replies can stop sequences',
})
export class BackfillLinkedinParticipantPersonMatchesCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly linkedinParticipantMatcherService: LinkedinParticipantMatcherService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    if (options.dryRun) {
      const totalCount = await this.countParticipants(workspaceId);

      this.logger.log(
        `[DRY RUN] Would attempt to match ${totalCount} LinkedIn thread participant(s) to Person records for workspace ${workspaceId}`,
      );

      return;
    }

    let processedCount = 0;
    let lastId: string | null = null;

    for (;;) {
      const participantIds = await this.getParticipantIdsBatch({
        workspaceId,
        afterId: lastId,
      });

      if (participantIds.length === 0) {
        break;
      }

      await this.linkedinParticipantMatcherService.matchParticipantsByIds({
        participantIds,
        workspaceId,
      });

      processedCount += participantIds.length;
      lastId = participantIds[participantIds.length - 1];

      if (participantIds.length < PARTICIPANT_BATCH_SIZE) {
        break;
      }
    }

    this.logger.log(
      `Attempted to match ${processedCount} LinkedIn thread participant(s) to Person records for workspace ${workspaceId}`,
    );
  }

  private async countParticipants(workspaceId: string): Promise<number> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<LinkedinThreadParticipantWorkspaceEntity>(
            workspaceId,
            'linkedinThreadParticipant',
            { shouldBypassPermissionChecks: true },
          );

        return repository.count();
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  private async getParticipantIdsBatch({
    workspaceId,
    afterId,
  }: {
    workspaceId: string;
    afterId: string | null;
  }): Promise<string[]> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<LinkedinThreadParticipantWorkspaceEntity>(
            workspaceId,
            'linkedinThreadParticipant',
            { shouldBypassPermissionChecks: true },
          );
        const rows = await repository.find({
          where: afterId ? { id: MoreThan(afterId) } : {},
          order: { id: 'ASC' },
          take: PARTICIPANT_BATCH_SIZE,
          select: ['id'],
        });

        return rows.map(({ id }) => id);
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
