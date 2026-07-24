import { Injectable } from '@nestjs/common';

import { type ObjectRecordCreateEvent } from 'twenty-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import {
  LinkedinConnectionMatchJob,
  type LinkedinConnectionMatchJobData,
} from 'src/modules/linkedin/jobs/linkedin-connection-match.job';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';

@Injectable()
export class LinkedinConnectionListener {
  constructor(
    @InjectMessageQueue(MessageQueue.messagingQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('linkedinConnection', DatabaseEventAction.CREATED)
  async handleCreatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<LinkedinConnectionWorkspaceEntity>
    >,
  ): Promise<void> {
    const connectionIds = payload.events.map(({ recordId }) => recordId);

    if (connectionIds.length === 0) {
      return;
    }

    await this.messageQueueService.add<LinkedinConnectionMatchJobData>(
      LinkedinConnectionMatchJob.name,
      {
        connectionIds,
        personIds: [],
        workspaceId: payload.workspaceId,
      },
    );
  }
}
