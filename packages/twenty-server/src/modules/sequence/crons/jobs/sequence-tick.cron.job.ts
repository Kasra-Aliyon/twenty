import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FeatureFlagKey } from 'twenty-shared/types';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { SequenceSchedulerService } from 'src/modules/sequence/services/sequence-scheduler.service';

export const SEQUENCE_TICK_DEFAULT_CRON_PATTERN = '* * * * *';

@Processor(MessageQueue.cronQueue)
export class SequenceTickCronJob {
  private readonly logger = new Logger(SequenceTickCronJob.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly featureFlagService: FeatureFlagService,
    private readonly sequenceSchedulerService: SequenceSchedulerService,
  ) {}

  @Process(SequenceTickCronJob.name)
  async handle(): Promise<void> {
    const activeWorkspaces = await this.workspaceRepository.find({
      where: { activationStatus: WorkspaceActivationStatus.ACTIVE },
      select: ['id'],
    });

    for (const workspace of activeWorkspaces) {
      try {
        const isEnabled = await this.featureFlagService.isFeatureEnabled(
          FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
          workspace.id,
        );

        if (!isEnabled) {
          continue;
        }

        await this.sequenceSchedulerService.tick(workspace.id);
      } catch (error) {
        this.logger.error(
          `Failed to run sequence tick for workspace ${workspace.id}`,
          error,
        );
      }
    }
  }
}
