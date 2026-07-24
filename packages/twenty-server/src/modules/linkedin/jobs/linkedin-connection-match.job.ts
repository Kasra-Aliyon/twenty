import { Scope } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { LinkedinConnectionMatcherService } from 'src/modules/linkedin/services/linkedin-connection-matcher.service';

export type LinkedinConnectionMatchJobData = {
  connectionIds: string[];
  personIds: string[];
  workspaceId: string;
};

@Processor({
  queueName: MessageQueue.messagingQueue,
  scope: Scope.REQUEST,
})
export class LinkedinConnectionMatchJob {
  constructor(
    private readonly linkedinConnectionMatcherService: LinkedinConnectionMatcherService,
  ) {}

  @Process(LinkedinConnectionMatchJob.name)
  async handle(data: LinkedinConnectionMatchJobData): Promise<void> {
    const { connectionIds, personIds, workspaceId } = data;

    if (connectionIds.length > 0) {
      await this.linkedinConnectionMatcherService.matchConnectionsByIds({
        connectionIds,
        workspaceId,
      });
    }

    if (personIds.length > 0) {
      await this.linkedinConnectionMatcherService.matchConnectionsForPeople({
        personIds,
        workspaceId,
      });
    }
  }
}
