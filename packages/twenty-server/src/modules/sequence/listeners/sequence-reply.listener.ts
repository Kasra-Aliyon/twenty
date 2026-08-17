import { Injectable } from '@nestjs/common';

import {
  FeatureFlagKey,
  MessageParticipantRole,
  SEQUENCE_ENROLLMENT_STATUSES,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { Equal, In, Not } from 'typeorm';

import { OnCustomBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-custom-batch-event.decorator';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import {
  SequenceEnrollmentWorkspaceEntity,
  type SequenceSentEmailMetadata,
} from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

type MessageParticipantMatchedEvent = {
  workspaceMemberId: string;
  participants: MessageParticipantWorkspaceEntity[];
};

const REPLY_ATTRIBUTION_MAX_ATTEMPTS = 3;

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
          status: Not(SEQUENCE_ENROLLMENT_STATUSES.REMOVED),
        },
        select: [
          'id',
          'personId',
          'status',
          'stopOnReply',
          'sentEmailsByStepId',
        ],
      });
      const repliedAt = new Date();
      const attributedEnrollments: SequenceEnrollmentWorkspaceEntity[] = [];

      for (const enrollment of enrollments) {
        const incomingThreadExternalIds = new Set(
          incomingParticipants
            .filter(({ personId }) => personId === enrollment.personId)
            .map(({ messageId }) =>
              incomingThreadExternalIdByMessageId.get(messageId),
            )
            .filter(isDefined),
        );
        const attributedEnrollment = await this.attributeReplyWithRetry({
          enrollment,
          enrollmentRepository,
          incomingThreadExternalIds,
          repliedAt,
        });

        if (isDefined(attributedEnrollment)) {
          attributedEnrollments.push(attributedEnrollment);
        }
      }

      if (attributedEnrollments.length === 0) {
        return;
      }

      const enrollmentIdsToStop = attributedEnrollments
        .filter(
          (enrollment) =>
            enrollment.stopOnReply &&
            (enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.PENDING ||
              enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE),
        )
        .map((enrollment) => enrollment.id);

      if (enrollmentIdsToStop.length === 0) {
        return;
      }

      await enrollmentRepository.update(
        {
          id: In(enrollmentIdsToStop),
          status: In([
            SEQUENCE_ENROLLMENT_STATUSES.PENDING,
            SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          ]),
          stopOnReply: true,
        },
        {
          status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
          waitingOn: null,
          nextActionAt: null,
          endedAt: repliedAt,
        },
      );
    }, buildSystemAuthContext(workspaceId));
  }

  private async attributeReplyWithRetry({
    enrollment: initialEnrollment,
    enrollmentRepository,
    incomingThreadExternalIds,
    repliedAt,
  }: {
    enrollment: SequenceEnrollmentWorkspaceEntity;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    incomingThreadExternalIds: Set<string>;
    repliedAt: Date;
  }): Promise<SequenceEnrollmentWorkspaceEntity | null> {
    let enrollment = initialEnrollment;

    for (
      let attempt = 0;
      attempt < REPLY_ATTRIBUTION_MAX_ATTEMPTS;
      attempt += 1
    ) {
      if (enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.REMOVED) {
        return null;
      }

      const sentEmailsByStepId = enrollment.sentEmailsByStepId ?? {};
      const updatedSentEmailsByStepId = this.buildReplyAttribution({
        incomingThreadExternalIds,
        repliedAt,
        sentEmailsByStepId,
      });

      if (!isDefined(updatedSentEmailsByStepId)) {
        return null;
      }

      const updateResult = await enrollmentRepository.update(
        {
          id: enrollment.id,
          sentEmailsByStepId: Equal(sentEmailsByStepId),
        },
        { sentEmailsByStepId: updatedSentEmailsByStepId },
      );

      if (updateResult.affected === 1) {
        return {
          ...enrollment,
          sentEmailsByStepId: updatedSentEmailsByStepId,
        };
      }

      const refreshedEnrollment = await enrollmentRepository.findOne({
        where: { id: enrollment.id },
        select: [
          'id',
          'personId',
          'status',
          'stopOnReply',
          'sentEmailsByStepId',
        ],
      });

      if (!isDefined(refreshedEnrollment)) {
        return null;
      }

      enrollment = refreshedEnrollment;
    }

    return null;
  }

  private buildReplyAttribution({
    incomingThreadExternalIds,
    repliedAt,
    sentEmailsByStepId,
  }: {
    incomingThreadExternalIds: Set<string>;
    repliedAt: Date;
    sentEmailsByStepId: Record<string, SequenceSentEmailMetadata>;
  }): Record<string, SequenceSentEmailMetadata> | null {
    const updatedSentEmailsByStepId = { ...sentEmailsByStepId };
    let hasAttribution = false;

    for (const threadExternalId of incomingThreadExternalIds) {
      const latestMatchingEntry = Object.entries(sentEmailsByStepId)
        .filter(
          ([, sentEmail]) => sentEmail.threadExternalId === threadExternalId,
        )
        .reduce<
          [string, SequenceSentEmailMetadata] | undefined
        >((latestEntry, currentEntry) => {
          if (!isDefined(latestEntry)) {
            return currentEntry;
          }

          return this.toTimestamp(currentEntry[1].sentAt) >
            this.toTimestamp(latestEntry[1].sentAt)
            ? currentEntry
            : latestEntry;
        }, undefined);

      if (!isDefined(latestMatchingEntry)) {
        continue;
      }

      const [stepId, sentEmail] = latestMatchingEntry;

      updatedSentEmailsByStepId[stepId] = {
        ...sentEmail,
        repliedAt: sentEmail.repliedAt ?? repliedAt.toISOString(),
      };
      hasAttribution = true;
    }

    return hasAttribution ? updatedSentEmailsByStepId : null;
  }

  private toTimestamp(value: string): number {
    const timestamp = Date.parse(value);

    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
}
