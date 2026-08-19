import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  FeatureFlagKey,
  MessageParticipantRole,
  SEQUENCE_ENROLLMENT_STATUSES,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { Equal, In, Not, type Repository } from 'typeorm';

import { OnCustomBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-custom-batch-event.decorator';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import {
  SequenceEnrollmentWorkspaceEntity,
  type SequenceSentEmailMetadata,
} from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

type MessageParticipantMatchedEvent = {
  workspaceMemberId: string;
  participants: MessageParticipantWorkspaceEntity[];
};

type IncomingMailboxMessage = {
  connectedAccountId: string;
  receivedAt: Date | null;
  threadExternalId: string | null;
};

const REPLY_ATTRIBUTION_MAX_ATTEMPTS = 3;

@Injectable()
export class SequenceReplyListener {
  constructor(
    private readonly featureFlagService: FeatureFlagService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
  ) {}

  @OnCustomBatchEvent('messageParticipant_matched')
  async handleMessageParticipantMatched(
    batchEvent: CustomWorkspaceEventBatch<MessageParticipantMatchedEvent>,
  ): Promise<void> {
    if (!isDefined(batchEvent.workspaceId)) {
      return;
    }

    await this.reconcileMessageParticipants({
      workspaceId: batchEvent.workspaceId,
      participants: batchEvent.events.flatMap(
        (event) => event.participants ?? [],
      ),
    });
  }

  async reconcileMessageParticipants({
    workspaceId,
    participants,
    sequenceEnrollmentId,
  }: {
    workspaceId: string;
    participants: MessageParticipantWorkspaceEntity[];
    sequenceEnrollmentId?: string;
  }): Promise<void> {
    const isEnabled = await this.featureFlagService.isFeatureEnabled(
      FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
      workspaceId,
    );

    if (!isEnabled) {
      return;
    }

    const fromParticipants = participants.filter(
      (participant) =>
        participant.role === MessageParticipantRole.FROM &&
        isDefined(participant.personId),
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
          messageChannelId: true,
        },
      });
      const incomingMessageIds = new Set(
        incomingAssociations.map(({ messageId }) => messageId),
      );
      const incomingParticipants = fromParticipants.filter(({ messageId }) =>
        incomingMessageIds.has(messageId),
      );
      const personIds = [
        ...new Set(incomingParticipants.map(({ personId }) => personId)),
      ].filter(isDefined);

      if (personIds.length === 0) {
        return;
      }

      const messageRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          MessageWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const incomingMessages = await messageRepository.find({
        where: { id: In([...incomingMessageIds]) },
        select: ['id', 'receivedAt'],
      });
      const receivedAtByMessageId = new Map(
        incomingMessages.map(({ id, receivedAt }) => [id, receivedAt]),
      );
      const enrollmentRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          workspaceId,
          SequenceEnrollmentWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

      const enrollments = await enrollmentRepository.find({
        where: {
          ...(isDefined(sequenceEnrollmentId)
            ? { id: sequenceEnrollmentId }
            : {}),
          personId: In(personIds),
          status: Not(SEQUENCE_ENROLLMENT_STATUSES.REMOVED),
        },
        select: [
          'id',
          'personId',
          'senderConnectedAccountId',
          'status',
          'stopOnReply',
          'sentEmailsByStepId',
        ],
      });
      const messageChannelIds = [
        ...new Set(
          incomingAssociations.map(({ messageChannelId }) => messageChannelId),
        ),
      ];
      const messageChannels =
        messageChannelIds.length > 0
          ? await this.messageChannelRepository.find({
              where: { id: In(messageChannelIds), workspaceId },
              select: { id: true, connectedAccountId: true },
            })
          : [];
      const connectedAccountIdByMessageChannelId = new Map(
        messageChannels.map(({ connectedAccountId, id }) => [
          id,
          connectedAccountId,
        ]),
      );
      const associationsByMessageId = new Map<
        string,
        typeof incomingAssociations
      >();

      for (const association of incomingAssociations) {
        const messageAssociations =
          associationsByMessageId.get(association.messageId) ?? [];

        messageAssociations.push(association);
        associationsByMessageId.set(association.messageId, messageAssociations);
      }

      const incomingMailboxMessagesByPersonId = new Map<
        string,
        IncomingMailboxMessage[]
      >();

      for (const participant of incomingParticipants) {
        if (!isDefined(participant.personId)) {
          continue;
        }

        const personMailboxMessages =
          incomingMailboxMessagesByPersonId.get(participant.personId) ?? [];

        for (const association of associationsByMessageId.get(
          participant.messageId,
        ) ?? []) {
          const connectedAccountId = connectedAccountIdByMessageChannelId.get(
            association.messageChannelId,
          );

          if (!isDefined(connectedAccountId)) {
            continue;
          }

          personMailboxMessages.push({
            connectedAccountId,
            receivedAt:
              receivedAtByMessageId.get(participant.messageId) ?? null,
            threadExternalId: association.messageThreadExternalId,
          });
        }

        incomingMailboxMessagesByPersonId.set(
          participant.personId,
          personMailboxMessages,
        );
      }

      const repliedAt = new Date();
      const enrollmentIdsToStop = new Set<string>();

      for (const enrollment of enrollments) {
        const attributedEnrollment = await this.attributeReplyWithRetry({
          enrollment,
          enrollmentRepository,
          incomingMailboxMessages:
            incomingMailboxMessagesByPersonId.get(enrollment.personId) ?? [],
        });

        if (isDefined(attributedEnrollment)) {
          if (
            attributedEnrollment.stopOnReply &&
            (attributedEnrollment.status ===
              SEQUENCE_ENROLLMENT_STATUSES.PENDING ||
              attributedEnrollment.status ===
                SEQUENCE_ENROLLMENT_STATUSES.ACTIVE)
          ) {
            enrollmentIdsToStop.add(attributedEnrollment.id);
          }
        }

        if (
          enrollment.stopOnReply &&
          (enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.PENDING ||
            enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE) &&
          this.hasReplyToEnrollmentSender({
            incomingMailboxMessages:
              incomingMailboxMessagesByPersonId.get(enrollment.personId) ?? [],
            enrollment,
          })
        ) {
          enrollmentIdsToStop.add(enrollment.id);
        }
      }

      if (enrollmentIdsToStop.size === 0) {
        return;
      }

      await enrollmentRepository.update(
        {
          id: In([...enrollmentIdsToStop]),
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

  private hasReplyToEnrollmentSender({
    incomingMailboxMessages,
    enrollment,
  }: {
    incomingMailboxMessages: IncomingMailboxMessage[];
    enrollment: SequenceEnrollmentWorkspaceEntity;
  }): boolean {
    const sentEmails = Object.values(enrollment.sentEmailsByStepId ?? {});

    if (incomingMailboxMessages.length === 0 || sentEmails.length === 0) {
      return false;
    }

    return incomingMailboxMessages.some(
      ({ connectedAccountId, receivedAt }) => {
        if (!isDefined(receivedAt)) {
          return false;
        }

        return sentEmails.some((sentEmail) => {
          // Successful-send metadata is the durable proof that this enrollment
          // actually contacted the person. For legacy rows, the enrollment's
          // pinned sender is still exact; an unassigned sender pool is not.
          const sentThroughConnectedAccountId =
            sentEmail.connectedAccountId ?? enrollment.senderConnectedAccountId;
          const sentAt = Date.parse(sentEmail.sentAt);

          return (
            sentThroughConnectedAccountId === connectedAccountId &&
            !Number.isNaN(sentAt) &&
            sentAt <= receivedAt.getTime()
          );
        });
      },
    );
  }

  private async attributeReplyWithRetry({
    enrollment: initialEnrollment,
    enrollmentRepository,
    incomingMailboxMessages,
  }: {
    enrollment: SequenceEnrollmentWorkspaceEntity;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    incomingMailboxMessages: IncomingMailboxMessage[];
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
        incomingMailboxMessages,
        senderConnectedAccountId: enrollment.senderConnectedAccountId,
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
          'senderConnectedAccountId',
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
    incomingMailboxMessages,
    senderConnectedAccountId,
    sentEmailsByStepId,
  }: {
    incomingMailboxMessages: IncomingMailboxMessage[];
    senderConnectedAccountId: string | null;
    sentEmailsByStepId: Record<string, SequenceSentEmailMetadata>;
  }): Record<string, SequenceSentEmailMetadata> | null {
    const updatedSentEmailsByStepId = { ...sentEmailsByStepId };
    let hasAttribution = false;
    const latestIncomingByMailboxThread = new Map<
      string,
      IncomingMailboxMessage
    >();

    for (const incomingMessage of incomingMailboxMessages) {
      if (
        !isDefined(incomingMessage.receivedAt) ||
        !isDefined(incomingMessage.threadExternalId)
      ) {
        continue;
      }

      const key = `${incomingMessage.connectedAccountId}\u0000${incomingMessage.threadExternalId}`;
      const existingMessage = latestIncomingByMailboxThread.get(key);

      if (
        !isDefined(existingMessage?.receivedAt) ||
        incomingMessage.receivedAt > existingMessage.receivedAt
      ) {
        latestIncomingByMailboxThread.set(key, incomingMessage);
      }
    }

    for (const {
      connectedAccountId,
      receivedAt,
      threadExternalId,
    } of latestIncomingByMailboxThread.values()) {
      const latestMatchingEntry = Object.entries(sentEmailsByStepId)
        .filter(
          ([, sentEmail]) =>
            sentEmail.threadExternalId === threadExternalId &&
            (sentEmail.connectedAccountId ?? senderConnectedAccountId) ===
              connectedAccountId &&
            // Contact matching may happen long after a historical message was
            // imported. It is a reply only if it arrived after this enrollment
            // actually sent into the thread.
            isDefined(receivedAt) &&
            receivedAt.getTime() >= this.toTimestamp(sentEmail.sentAt),
        )
        .reduce<[string, SequenceSentEmailMetadata] | undefined>(
          (latestEntry, currentEntry) => {
            if (!isDefined(latestEntry)) {
              return currentEntry;
            }

            return this.toTimestamp(currentEntry[1].sentAt) >
              this.toTimestamp(latestEntry[1].sentAt)
              ? currentEntry
              : latestEntry;
          },
          undefined,
        );

      if (!isDefined(receivedAt) || !isDefined(latestMatchingEntry)) {
        continue;
      }

      const [stepId, sentEmail] = latestMatchingEntry;

      updatedSentEmailsByStepId[stepId] = {
        ...sentEmail,
        repliedAt: sentEmail.repliedAt ?? receivedAt.toISOString(),
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
