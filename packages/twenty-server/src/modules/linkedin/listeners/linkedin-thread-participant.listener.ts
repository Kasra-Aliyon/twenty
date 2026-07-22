import { Injectable } from '@nestjs/common';

import { type ObjectRecordCreateEvent } from 'twenty-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import {
  LinkedinThreadParticipantMatchJob,
  type LinkedinThreadParticipantMatchJobData,
} from 'src/modules/linkedin/jobs/linkedin-thread-participant-match.job';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';

@Injectable()
export class LinkedinThreadParticipantListener {
  constructor(
    @InjectMessageQueue(MessageQueue.messagingQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent(
    'linkedinThreadParticipant',
    DatabaseEventAction.CREATED,
  )
  async handleCreatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<LinkedinThreadParticipantWorkspaceEntity>
    >,
  ): Promise<void> {
    const participantIds = payload.events.map(({ recordId }) => recordId);

    if (participantIds.length === 0) {
      return;
    }

    await this.messageQueueService.add<LinkedinThreadParticipantMatchJobData>(
      LinkedinThreadParticipantMatchJob.name,
      {
        participantIds,
        personIds: [],
        workspaceId: payload.workspaceId,
      },
    );
  }
}
