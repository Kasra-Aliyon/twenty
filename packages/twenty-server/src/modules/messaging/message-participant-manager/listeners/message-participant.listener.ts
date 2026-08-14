import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { MessageParticipantRole } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In, Repository } from 'typeorm';

import { OnCustomBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-custom-batch-event.decorator';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InjectObjectMetadataRepository } from 'src/engine/object-metadata-repository/object-metadata-repository.decorator';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';
import { MessageDirection } from 'src/modules/messaging/common/enums/message-direction.enum';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { TimelineActivityRepository } from 'src/modules/timeline/repositories/timeline-activity.repository';
import { TimelineActivityWorkspaceEntity } from 'src/modules/timeline/standard-objects/timeline-activity.workspace-entity';

@Injectable()
export class MessageParticipantListener {
  constructor(
    @InjectObjectMetadataRepository(TimelineActivityWorkspaceEntity)
    private readonly timelineActivityRepository: TimelineActivityRepository,
    @InjectRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    private readonly featureFlagService: FeatureFlagService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  @OnCustomBatchEvent('messageParticipant_matched')
  public async handleMessageParticipantMatched(
    batchEvent: CustomWorkspaceEventBatch<{
      workspaceMemberId: string;
      participants: MessageParticipantWorkspaceEntity[];
    }>,
  ): Promise<void> {
    if (!isDefined(batchEvent.workspaceId)) {
      return;
    }

    const workspaceId = batchEvent.workspaceId;
    const messageParticipantsWithPersonId = batchEvent.events.flatMap((event) =>
      (event.participants ?? []).filter((participant) =>
        isDefined(participant.personId),
      ),
    );

    if (messageParticipantsWithPersonId.length === 0) {
      return;
    }

    const messageIds = [
      ...new Set(
        messageParticipantsWithPersonId.map(({ messageId }) => messageId),
      ),
    ];
    const { associations, messages } =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const associationRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              MessageChannelMessageAssociationWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );
          const messageRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              MessageWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );

          const [associations, messages] = await Promise.all([
            associationRepository.find({
              where: { messageId: In(messageIds) },
              select: { direction: true, messageId: true },
            }),
            messageRepository.find({
              where: { id: In(messageIds) },
              select: { id: true, receivedAt: true },
            }),
          ]);

          return { associations, messages };
        },
        buildSystemAuthContext(workspaceId),
      );
    const directionByMessageId = new Map(
      associations.map(({ direction, messageId }) => [messageId, direction]),
    );
    const happensAtByMessageId = new Map(
      messages.map(({ id, receivedAt }) => [id, receivedAt]),
    );
    const messageObjectMetadata =
      await this.objectMetadataRepository.findOneOrFail({
        where: {
          nameSingular: 'message',
          workspaceId,
        },
      });

    const timelineActivityPayloads = batchEvent.events.flatMap((event) => {
      const matchedParticipants = (event.participants ?? []).filter(
        (participant) => isDefined(participant.personId),
      );

      if (matchedParticipants.length === 0) {
        return;
      }

      return matchedParticipants
        .map((participant) => {
          if (!isDefined(participant.personId)) {
            return;
          }

          const direction = directionByMessageId.get(participant.messageId);

          if (
            (direction === MessageDirection.INCOMING &&
              participant.role !== MessageParticipantRole.FROM) ||
            (direction === MessageDirection.OUTGOING &&
              participant.role === MessageParticipantRole.FROM)
          ) {
            return;
          }

          const name =
            direction === MessageDirection.INCOMING
              ? 'message.received'
              : direction === MessageDirection.OUTGOING
                ? 'message.sent'
                : 'message.linked';

          return {
            happensAt:
              happensAtByMessageId.get(participant.messageId) ?? undefined,
            name,
            properties: {},
            objectSingularName: 'person',
            recordId: participant.personId,
            workspaceMemberId: event.workspaceMemberId,
            linkedObjectMetadataId: messageObjectMetadata.id,
            linkedRecordId: participant.messageId,
            linkedRecordCachedName: '',
          };
        })
        .filter(isDefined);
    });

    await this.timelineActivityRepository.upsertTimelineActivities({
      objectSingularName: 'person',
      workspaceId,
      payloads: timelineActivityPayloads.filter(isDefined),
    });
  }
}
