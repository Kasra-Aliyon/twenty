import { Injectable } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import {
  LinkedinConnectionMatchJob,
  type LinkedinConnectionMatchJobData,
} from 'src/modules/linkedin/jobs/linkedin-connection-match.job';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';

const CONNECTION_MATCHING_FIELDS = ['handle', 'name'] as const;

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
    await this.enqueueConnections(
      payload.events.map(({ recordId }) => recordId),
      payload.workspaceId,
    );
  }

  @OnDatabaseBatchEvent('linkedinConnection', DatabaseEventAction.UPDATED)
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<LinkedinConnectionWorkspaceEntity>
    >,
  ): Promise<void> {
    const connectionIds = payload.events
      .filter(({ properties }) => {
        const changedProperties = objectRecordChangedProperties(
          properties.before,
          properties.after,
        );

        return CONNECTION_MATCHING_FIELDS.some((field) =>
          changedProperties.includes(field),
        );
      })
      .map(({ recordId }) => recordId);

    await this.enqueueConnections(connectionIds, payload.workspaceId);
  }

  private async enqueueConnections(
    connectionIds: string[],
    workspaceId: string,
  ): Promise<void> {
    if (connectionIds.length === 0) {
      return;
    }

    await this.messageQueueService.add<LinkedinConnectionMatchJobData>(
      LinkedinConnectionMatchJob.name,
      {
        connectionIds: [...new Set(connectionIds)],
        personIds: [],
        workspaceId,
      },
    );
  }
}
