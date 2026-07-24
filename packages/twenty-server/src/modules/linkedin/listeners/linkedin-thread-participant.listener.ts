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
  LinkedinThreadParticipantMatchJob,
  type LinkedinThreadParticipantMatchJobData,
} from 'src/modules/linkedin/jobs/linkedin-thread-participant-match.job';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';

const PARTICIPANT_MATCHING_FIELDS = [
  'handle',
  'isSelf',
  'linkedinUrn',
  'name',
  'threadId',
] as const;

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
    await this.enqueueParticipants(
      payload.events.map(({ recordId }) => recordId),
      payload.workspaceId,
    );
  }

  @OnDatabaseBatchEvent(
    'linkedinThreadParticipant',
    DatabaseEventAction.UPDATED,
  )
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<LinkedinThreadParticipantWorkspaceEntity>
    >,
  ): Promise<void> {
    const participantIds = payload.events
      .filter(({ properties }) => {
        const changedProperties = objectRecordChangedProperties(
          properties.before,
          properties.after,
        );

        return PARTICIPANT_MATCHING_FIELDS.some((field) =>
          changedProperties.includes(field),
        );
      })
      .map(({ recordId }) => recordId);

    await this.enqueueParticipants(participantIds, payload.workspaceId);
  }

  private async enqueueParticipants(
    participantIds: string[],
    workspaceId: string,
  ): Promise<void> {
    if (participantIds.length === 0) {
      return;
    }

    await this.messageQueueService.add<LinkedinThreadParticipantMatchJobData>(
      LinkedinThreadParticipantMatchJob.name,
      {
        participantIds: [...new Set(participantIds)],
        personIds: [],
        workspaceId,
      },
    );
  }
}
