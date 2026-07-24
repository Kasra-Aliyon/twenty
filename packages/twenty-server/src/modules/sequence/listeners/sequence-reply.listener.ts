import { Injectable } from '@nestjs/common';

import {
  FeatureFlagKey,
  MessageParticipantRole,
  SEQUENCE_ENROLLMENT_STATUSES,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { OnCustomBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-custom-batch-event.decorator';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

type MessageParticipantMatchedEvent = {
  workspaceMemberId: string;
  participants: MessageParticipantWorkspaceEntity[];
};

@Injectable()
export class SequenceReplyListener {
  constructor(
    private readonly featureFlagService: FeatureFlagService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  @OnCustomBatchEvent('messageParticipant_matched')
  async handleMessageParticipantMatched(
    batchEvent: CustomWorkspaceEventBatch<MessageParticipantMatchedEvent>,
  ): Promise<void> {
    if (!isDefined(batchEvent.workspaceId)) {
      return;
    }

    const workspaceId = batchEvent.workspaceId;
    const isEnabled = await this.featureFlagService.isFeatureEnabled(
      FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
      workspaceId,
    );

    if (!isEnabled) {
      return;
    }

    const fromParticipants = batchEvent.events.flatMap((event) =>
      (event.participants ?? []).filter(
        (participant) =>
          participant.role === MessageParticipantRole.FROM &&
          isDefined(participant.personId),
      ),
    );

    if (fromParticipants.length === 0) {
      return;
    }

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const associationRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          MessageChannelMessageAssociationWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const incomingAssociations = await associationRepository.find({
        where: {
          messageId: In([
            ...new Set(fromParticipants.map(({ messageId }) => messageId)),
          ]),
          direction: MessageDirection.INCOMING,
        },
        select: {
          messageId: true,
          messageThreadExternalId: true,
        },
      });
      const incomingThreadExternalIdByMessageId = new Map(
        incomingAssociations
          .filter(({ messageThreadExternalId }) =>
            isDefined(messageThreadExternalId),
          )
          .map(({ messageId, messageThreadExternalId }) => [
            messageId,
            messageThreadExternalId as string,
          ]),
      );
      const incomingParticipants = fromParticipants.filter(({ messageId }) =>
        incomingThreadExternalIdByMessageId.has(messageId),
      );
      const personIds = [
        ...new Set(incomingParticipants.map(({ personId }) => personId)),
      ].filter(isDefined);

      if (personIds.length === 0) {
        return;
      }

      const enrollmentRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceEnrollmentWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      const enrollments = await enrollmentRepository.find({
        where: {
          personId: In(personIds),
          status: In([
            SEQUENCE_ENROLLMENT_STATUSES.PENDING,
            SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          ]),
          stopOnReply: true,
        },
        select: ['id', 'personId', 'sentEmailsByStepId'],
      });
      const repliedEnrollmentIds = enrollments
        .filter((enrollment) => {
          const sentThreadExternalIds = new Set(
            Object.values(enrollment.sentEmailsByStepId ?? {}).map(
              ({ threadExternalId }) => threadExternalId,
            ),
          );

          return incomingParticipants.some(
            ({ messageId, personId }) =>
              personId === enrollment.personId &&
              sentThreadExternalIds.has(
                incomingThreadExternalIdByMessageId.get(messageId) ?? '',
              ),
          );
        })
        .map(({ id }) => id);

      if (repliedEnrollmentIds.length === 0) {
        return;
      }

      await enrollmentRepository.update(
        { id: In(repliedEnrollmentIds) },
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
