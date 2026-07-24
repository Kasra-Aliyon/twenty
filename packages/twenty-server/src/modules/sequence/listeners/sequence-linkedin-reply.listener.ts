import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
import {
  FeatureFlagKey,
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In, IsNull, Not } from 'typeorm';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { objectRecordChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { type LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

@Injectable()
export class SequenceLinkedinReplyListener {
  constructor(
    private readonly featureFlagService: FeatureFlagService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  @OnDatabaseBatchEvent('linkedinMessage', DatabaseEventAction.CREATED)
  async handleMessageCreatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<LinkedinMessageWorkspaceEntity>
    >,
  ): Promise<void> {
    await this.stopEnrollmentsForThreads({
      threadIds: payload.events
        .map(({ properties }) => properties.after)
        .filter(({ direction }) => direction === 'INBOUND')
        .map(({ threadId }) => threadId),
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
    await this.stopEnrollmentsForThreads({
      threadIds: payload.events
        .filter(
          ({ properties }) =>
            objectRecordChangedProperties(
              properties.before,
              properties.after,
            ).includes('personId') &&
            !properties.after.isSelf &&
            isDefined(properties.after.personId),
        )
        .map(({ properties }) => properties.after.threadId),
      workspaceId: payload.workspaceId,
    });
  }

  private async stopEnrollmentsForThreads({
    threadIds,
    workspaceId,
  }: {
    threadIds: string[];
    workspaceId: string;
  }): Promise<void> {
    const uniqueThreadIds = [...new Set(threadIds)];

    if (uniqueThreadIds.length === 0) {
      return;
    }

    const isEnabled = await this.featureFlagService.isFeatureEnabled(
      FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
      workspaceId,
    );

    if (!isEnabled) {
      return;
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const [messageRepository, participantRepository] = await Promise.all([
        this.globalWorkspaceOrmManager.getRepository<LinkedinMessageWorkspaceEntity>(
          workspaceId,
          'linkedinMessage',
          { shouldBypassPermissionChecks: true },
        ),
        this.globalWorkspaceOrmManager.getRepository<LinkedinThreadParticipantWorkspaceEntity>(
          workspaceId,
          'linkedinThreadParticipant',
          { shouldBypassPermissionChecks: true },
        ),
      ]);
      const [inboundMessages, participants] = await Promise.all([
        messageRepository.find({
          where: {
            threadId: In(uniqueThreadIds),
            direction: 'INBOUND',
          },
          select: [
            'deliveredAt',
            'ownerWorkspaceMemberId',
            'senderLinkedinUrn',
            'threadId',
          ],
        }),
        participantRepository.find({
          where: {
            threadId: In(uniqueThreadIds),
            isSelf: false,
            personId: Not(IsNull()),
          },
          select: ['linkedinUrn', 'personId', 'threadId'],
        }),
      ]);
      const personIds = [
        ...new Set(participants.map(({ personId }) => personId)),
      ].filter(isDefined);

      if (inboundMessages.length === 0 || personIds.length === 0) {
        return;
      }

      const actionRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          LinkedinActionWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const completedOutboundActions = await actionRepository.find({
        where: {
          personId: In(personIds),
          type: In([
            LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
            LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
          ]),
          status: LINKEDIN_ACTION_STATUSES.COMPLETED,
          sequenceEnrollmentId: Not(IsNull()),
          executedAt: Not(IsNull()),
          ownerWorkspaceMemberId: Not(IsNull()),
        },
        select: [
          'executedAt',
          'ownerWorkspaceMemberId',
          'personId',
          'sequenceEnrollmentId',
        ],
      });
      const participantsByThreadId = new Map<
        string,
        Array<{
          linkedinUrn: string | null;
          personId: string;
        }>
      >();

      for (const participant of participants) {
        if (!isDefined(participant.personId)) {
          continue;
        }

        const threadParticipants =
          participantsByThreadId.get(participant.threadId) ?? [];

        threadParticipants.push({
          linkedinUrn: participant.linkedinUrn,
          personId: participant.personId,
        });
        participantsByThreadId.set(participant.threadId, threadParticipants);
      }

      const repliedEnrollmentIds = new Set<string>();

      for (const message of inboundMessages) {
        const threadParticipants = participantsByThreadId.get(message.threadId);

        if (!isDefined(threadParticipants)) {
          continue;
        }

        const senderPersonIds = new Set(
          isNonEmptyString(message.senderLinkedinUrn)
            ? threadParticipants
                .filter(
                  ({ linkedinUrn }) =>
                    linkedinUrn === message.senderLinkedinUrn,
                )
                .map(({ personId }) => personId)
            : threadParticipants.length === 1
              ? [threadParticipants[0].personId]
              : [],
        );

        for (const action of completedOutboundActions) {
          if (
            isDefined(action.sequenceEnrollmentId) &&
            isDefined(action.executedAt) &&
            isDefined(action.ownerWorkspaceMemberId) &&
            action.ownerWorkspaceMemberId === message.ownerWorkspaceMemberId &&
            senderPersonIds.has(action.personId) &&
            action.executedAt.getTime() <= message.deliveredAt.getTime()
          ) {
            repliedEnrollmentIds.add(action.sequenceEnrollmentId);
          }
        }
      }

      if (repliedEnrollmentIds.size === 0) {
        return;
      }

      const enrollmentRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceEnrollmentWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const eligibleEnrollments = await enrollmentRepository.find({
        where: {
          id: In([...repliedEnrollmentIds]),
          status: In([
            SEQUENCE_ENROLLMENT_STATUSES.PENDING,
            SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          ]),
          stopOnReply: true,
        },
        select: ['id'],
      });
      const eligibleEnrollmentIds = eligibleEnrollments.map(({ id }) => id);

      if (eligibleEnrollmentIds.length === 0) {
        return;
      }

      await enrollmentRepository.update(
        { id: In(eligibleEnrollmentIds) },
        {
          status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
          waitingOn: null,
          nextActionAt: null,
          endedAt: new Date(),
        },
      );
    }, buildSystemAuthContext(workspaceId));
  }
}
