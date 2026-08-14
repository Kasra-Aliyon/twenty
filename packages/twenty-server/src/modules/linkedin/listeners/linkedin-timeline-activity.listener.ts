import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  type LinkedInActionType,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';
import { v5 } from 'uuid';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { InjectObjectMetadataRepository } from 'src/engine/object-metadata-repository/object-metadata-repository.decorator';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { type LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { type LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { TimelineActivityRepository } from 'src/modules/timeline/repositories/timeline-activity.repository';
import { TimelineActivityWorkspaceEntity } from 'src/modules/timeline/standard-objects/timeline-activity.workspace-entity';
import { type TimelineActivityPayload } from 'src/modules/timeline/types/timeline-activity-payload';

const LINKEDIN_TIMELINE_ACTIVITY_ID_NAMESPACE =
  '87dcfc4f-d780-48c4-850f-c0a5060cb15a';

const LINKEDIN_ACTION_ACTIVITY_NAME_BY_TYPE: Record<
  LinkedInActionType,
  string
> = {
  [LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST]:
    'linkedin.connection-request-sent',
  [LINKEDIN_ACTION_TYPES.SEND_MESSAGE]: 'linkedin.message-sent',
  [LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST]:
    'linkedin.connection-request-withdrawn',
};

type LinkedinMessageTarget = {
  message: LinkedinMessageWorkspaceEntity;
  personId: string;
};

@Injectable()
export class LinkedinTimelineActivityListener {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectObjectMetadataRepository(TimelineActivityWorkspaceEntity)
    private readonly timelineActivityRepository: TimelineActivityRepository,
  ) {}

  @OnDatabaseBatchEvent('linkedinAction', DatabaseEventAction.CREATED)
  async handleActionCreatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<LinkedinActionWorkspaceEntity>
    >,
  ): Promise<void> {
    await this.upsertCompletedActions({
      actions: payload.events.map(({ properties }) => properties.after),
      workspaceId: payload.workspaceId,
    });
  }

  @OnDatabaseBatchEvent('linkedinAction', DatabaseEventAction.UPDATED)
  async handleActionUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<LinkedinActionWorkspaceEntity>
    >,
  ): Promise<void> {
    await this.upsertCompletedActions({
      actions: payload.events
        .filter((event) =>
          ['connectionState', 'executedAt', 'personId', 'status'].some(
            (field) =>
              objectRecordChangedProperties(
                event.properties.before,
                event.properties.after,
              ).includes(field),
          ),
        )
        .map(({ properties }) => properties.after),
      workspaceId: payload.workspaceId,
    });
  }

  @OnDatabaseBatchEvent('linkedinMessage', DatabaseEventAction.CREATED)
  async handleMessageCreatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<LinkedinMessageWorkspaceEntity>
    >,
  ): Promise<void> {
    await this.upsertMessages({
      messages: payload.events.map(({ properties }) => properties.after),
      workspaceId: payload.workspaceId,
    });
  }

  @OnDatabaseBatchEvent(
    'linkedinThreadParticipant',
    DatabaseEventAction.UPDATED,
  )
  async handleParticipantUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<LinkedinThreadParticipantWorkspaceEntity>
    >,
  ): Promise<void> {
    const threadIds = [
      ...new Set(
        payload.events
          .filter(({ properties }) =>
            objectRecordChangedProperties(
              properties.before,
              properties.after,
            ).includes('personId'),
          )
          .map(({ properties }) => properties.after.threadId),
      ),
    ];

    if (threadIds.length === 0) {
      return;
    }

    const messages =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const messageRepository =
            await this.globalWorkspaceOrmManager.getRepository<LinkedinMessageWorkspaceEntity>(
              payload.workspaceId,
              'linkedinMessage',
              { shouldBypassPermissionChecks: true },
            );

          return messageRepository.find({ where: { threadId: In(threadIds) } });
        },
        buildSystemAuthContext(payload.workspaceId),
      );

    await this.upsertMessages({ messages, workspaceId: payload.workspaceId });
  }

  @OnDatabaseBatchEvent('linkedinConnection', DatabaseEventAction.CREATED)
  async handleConnectionCreatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<LinkedinConnectionWorkspaceEntity>
    >,
  ): Promise<void> {
    await this.upsertConnections({
      connections: payload.events.map(({ properties }) => properties.after),
      workspaceId: payload.workspaceId,
    });
  }

  @OnDatabaseBatchEvent('linkedinConnection', DatabaseEventAction.UPDATED)
  async handleConnectionUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<LinkedinConnectionWorkspaceEntity>
    >,
  ): Promise<void> {
    await this.upsertConnections({
      connections: payload.events
        .filter(({ properties }) => {
          const changedProperties = objectRecordChangedProperties(
            properties.before,
            properties.after,
          );

          return (
            changedProperties.includes('connectedAt') ||
            changedProperties.includes('personId')
          );
        })
        .map(({ properties }) => properties.after),
      workspaceId: payload.workspaceId,
    });
  }

  private async upsertConnections({
    connections,
    workspaceId,
  }: {
    connections: LinkedinConnectionWorkspaceEntity[];
    workspaceId: string;
  }): Promise<void> {
    const timelineActivityPayloads = connections.flatMap((connection) => {
      if (!isDefined(connection.personId)) {
        return [];
      }

      return [
        this.buildTimelineActivityPayload({
          happensAt: this.toDate(
            connection.connectedAt ?? connection.createdAt,
          ),
          name: 'linkedin.connection-established',
          personId: connection.personId,
          sourceObjectName: 'linkedinConnection',
          sourceRecordId: connection.id,
          workspaceMemberId: connection.ownerWorkspaceMemberId,
        }),
      ];
    });

    await this.upsertTimelineActivities({
      payloads: timelineActivityPayloads,
      workspaceId,
    });
  }

  private async upsertCompletedActions({
    actions,
    workspaceId,
  }: {
    actions: LinkedinActionWorkspaceEntity[];
    workspaceId: string;
  }): Promise<void> {
    const timelineActivityPayloads = actions.flatMap((action) => {
      if (
        action.status !== LINKEDIN_ACTION_STATUSES.COMPLETED ||
        !isDefined(action.personId) ||
        (action.type === LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST &&
          action.connectionState !== LINKEDIN_CONNECTION_STATES.PENDING) ||
        (action.type === LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST &&
          action.connectionState !== LINKEDIN_CONNECTION_STATES.WITHDRAWN)
      ) {
        return [];
      }

      const name = LINKEDIN_ACTION_ACTIVITY_NAME_BY_TYPE[action.type];

      if (!isDefined(name)) {
        return [];
      }

      return [
        this.buildTimelineActivityPayload({
          happensAt: this.toDate(action.executedAt ?? action.updatedAt),
          name,
          personId: action.personId,
          sourceObjectName: 'linkedinAction',
          sourceRecordId: action.id,
          workspaceMemberId: action.ownerWorkspaceMemberId,
        }),
      ];
    });

    await this.upsertTimelineActivities({
      payloads: timelineActivityPayloads,
      workspaceId,
    });
  }

  private async upsertMessages({
    messages,
    workspaceId,
  }: {
    messages: LinkedinMessageWorkspaceEntity[];
    workspaceId: string;
  }): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const threadIds = [...new Set(messages.map(({ threadId }) => threadId))];
    const participants =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const participantRepository =
            await this.globalWorkspaceOrmManager.getRepository<LinkedinThreadParticipantWorkspaceEntity>(
              workspaceId,
              'linkedinThreadParticipant',
              { shouldBypassPermissionChecks: true },
            );

          return participantRepository.find({
            where: {
              threadId: In(threadIds),
              isSelf: false,
            },
          });
        },
        buildSystemAuthContext(workspaceId),
      );
    const messageTargets = this.resolveMessageTargets({
      messages: messages.filter(({ direction }) => direction === 'INBOUND'),
      participants,
    });

    if (messageTargets.length === 0) {
      return;
    }

    const timelineActivityPayloads = messageTargets.map(
      ({ message, personId }) => {
        return this.buildTimelineActivityPayload({
          happensAt: this.toDate(message.deliveredAt),
          name: 'linkedin.message-received',
          personId,
          sourceObjectName: 'linkedinMessage',
          sourceRecordId: message.id,
          workspaceMemberId: message.ownerWorkspaceMemberId,
        });
      },
    );

    await this.upsertTimelineActivities({
      payloads: timelineActivityPayloads,
      workspaceId,
    });
  }

  private resolveMessageTargets({
    messages,
    participants,
  }: {
    messages: LinkedinMessageWorkspaceEntity[];
    participants: LinkedinThreadParticipantWorkspaceEntity[];
  }): LinkedinMessageTarget[] {
    return messages.flatMap((message) => {
      const threadParticipants = participants.filter(
        ({ threadId }) => threadId === message.threadId,
      );
      const targetParticipants = isNonEmptyString(message.senderLinkedinUrn)
        ? threadParticipants.filter(
            ({ linkedinUrn }) => linkedinUrn === message.senderLinkedinUrn,
          )
        : threadParticipants.length === 1
          ? threadParticipants
          : [];

      const personIds = [
        ...new Set(
          targetParticipants.map(({ personId }) => personId).filter(isDefined),
        ),
      ];

      return personIds.length === 1
        ? [{ message, personId: personIds[0] }]
        : [];
    });
  }

  private buildTimelineActivityPayload({
    happensAt,
    name,
    personId,
    sourceObjectName,
    sourceRecordId,
    workspaceMemberId,
  }: {
    happensAt: Date | undefined;
    name: string;
    personId: string;
    sourceObjectName: string;
    sourceRecordId: string;
    workspaceMemberId: string | null;
  }): TimelineActivityPayload {
    return {
      id: v5(
        `${sourceObjectName}:${sourceRecordId}:${name}`,
        LINKEDIN_TIMELINE_ACTIVITY_ID_NAMESPACE,
      ),
      happensAt,
      name,
      objectSingularName: 'person',
      properties: {},
      recordId: personId,
      workspaceMemberId: workspaceMemberId ?? undefined,
    };
  }

  private async upsertTimelineActivities({
    payloads,
    workspaceId,
  }: {
    payloads: TimelineActivityPayload[];
    workspaceId: string;
  }): Promise<void> {
    if (payloads.length === 0) {
      return;
    }

    await this.timelineActivityRepository.upsertTimelineActivities({
      objectSingularName: 'person',
      payloads,
      workspaceId,
    });
  }

  private toDate(value: Date | string | null | undefined): Date | undefined {
    if (!isDefined(value)) {
      return undefined;
    }

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
