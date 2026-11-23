import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { LinkedinConnectionOwnersService } from 'src/modules/linkedin/services/linkedin-connection-owners.service';

@Processor(MessageQueue.cronQueue)
export class LinkedinConnectionOwnersCronJob {
  private readonly logger = new Logger(LinkedinConnectionOwnersCronJob.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly linkedinConnectionOwnersService: LinkedinConnectionOwnersService,
  ) {}

  @Process(LinkedinConnectionOwnersCronJob.name)
  async handle(): Promise<void> {
    const activeWorkspaces = await this.workspaceRepository.find({
      where: { activationStatus: WorkspaceActivationStatus.ACTIVE },
      select: ['id'],
    });

    for (const workspace of activeWorkspaces) {
      try {
        await this.linkedinConnectionOwnersService.refresh(workspace.id);
      } catch (error) {
        this.logger.error(
          `Failed to refresh LinkedIn connection owners for workspace ${workspace.id}`,
          error,
        );
      }
    }
  }
}
