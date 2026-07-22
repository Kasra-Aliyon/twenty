import { Scope } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { LinkedinParticipantMatcherService } from 'src/modules/linkedin/services/linkedin-participant-matcher.service';

export type LinkedinThreadParticipantMatchJobData = {
  participantIds: string[];
  personIds: string[];
  workspaceId: string;
};

@Processor({
  queueName: MessageQueue.messagingQueue,
  scope: Scope.REQUEST,
})
export class LinkedinThreadParticipantMatchJob {
  constructor(
    private readonly linkedinParticipantMatcherService: LinkedinParticipantMatcherService,
  ) {}

  @Process(LinkedinThreadParticipantMatchJob.name)
  async handle(data: LinkedinThreadParticipantMatchJobData): Promise<void> {
    const { participantIds, personIds, workspaceId } = data;

    if (participantIds.length > 0) {
      await this.linkedinParticipantMatcherService.matchParticipantsByIds({
        participantIds,
        workspaceId,
      });
    }

    if (personIds.length > 0) {
      await this.linkedinParticipantMatcherService.matchParticipantsForPeople({
        personIds,
        workspaceId,
      });
    }
  }
}
