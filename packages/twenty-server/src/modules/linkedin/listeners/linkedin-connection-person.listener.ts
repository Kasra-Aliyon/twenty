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
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

const PERSON_MATCHING_FIELDS = ['linkedinLink', 'name'] as const;

@Injectable()
export class LinkedinConnectionPersonListener {
  constructor(
    @InjectMessageQueue(MessageQueue.messagingQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('person', DatabaseEventAction.CREATED)
  async handleCreatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<PersonWorkspaceEntity>
    >,
  ): Promise<void> {
    await this.enqueuePeople(
      payload.events.map(({ recordId }) => recordId),
      payload.workspaceId,
    );
  }

  @OnDatabaseBatchEvent('person', DatabaseEventAction.UPDATED)
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<PersonWorkspaceEntity>
    >,
  ): Promise<void> {
    const personIds = payload.events
      .filter(({ properties }) => {
        const changedProperties = objectRecordChangedProperties(
          properties.before,
          properties.after,
        );

        return PERSON_MATCHING_FIELDS.some((field) =>
          changedProperties.includes(field),
        );
      })
      .map(({ recordId }) => recordId);

    await this.enqueuePeople(personIds, payload.workspaceId);
  }

  private async enqueuePeople(
    personIds: string[],
    workspaceId: string,
  ): Promise<void> {
    if (personIds.length === 0) {
      return;
    }

    await this.messageQueueService.add<LinkedinConnectionMatchJobData>(
      LinkedinConnectionMatchJob.name,
      {
        connectionIds: [],
        personIds: [...new Set(personIds)],
        workspaceId,
      },
    );
  }
}
