import { Command } from 'nest-commander';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

@RegisteredWorkspaceCommand('2.15.0', 1800000024000)
@Command({
  name: 'upgrade:2-15:recompute-sequence-counters',
  description:
    'Repair stored sequence counters after fixing transactional recompute races',
})
export class RecomputeSequenceCountersCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceMetricsService: SequenceMetricsService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const sequenceIds =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const sequenceRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              SequenceWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );
          const sequences = await sequenceRepository.find({
            select: ['id'],
            // Restorable archived sequences must be repaired too; otherwise
            // stale counters reappear as soon as one is restored.
            withDeleted: true,
          });

          return sequences.map(({ id }) => id);
        },
        buildSystemAuthContext(workspaceId),
      );

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Would recompute counters for ${sequenceIds.length} sequence(s) in workspace ${workspaceId}`,
      );

      return;
    }

    for (const sequenceId of sequenceIds) {
      await this.sequenceMetricsService.recomputeForSequence({
        workspaceId,
        sequenceId,
      });
    }

    this.logger.log(
      `Recomputed counters for ${sequenceIds.length} sequence(s) in workspace ${workspaceId}`,
    );
  }
}
