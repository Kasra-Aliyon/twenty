import { Injectable } from '@nestjs/common';

import { In } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type ParticipantWithMessageId } from 'src/modules/messaging/message-import-manager/drivers/gmail/types/gmail-message.type';

@Injectable()
export class MessagingMessageParticipantService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly matchParticipantService: MatchParticipantService<MessageParticipantWorkspaceEntity>,
  ) {}

  public async saveMessageParticipants(
    participants: ParticipantWithMessageId[],
    workspaceId: string,
    transactionManager?: WorkspaceEntityManager,
  ): Promise<MessageParticipantWorkspaceEntity[]> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageParticipantRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageParticipantWorkspaceEntity>(
            workspaceId,
            'messageParticipant',
          );

        const existingParticipantsBasedOnMessageIds =
          await messageParticipantRepository.find({
            where: {
              messageId: In(
                participants.map((participant) => participant.messageId),
              ),
            },
          });

        const participantsToCreate: Pick<
          MessageParticipantWorkspaceEntity,
          'messageId' | 'handle' | 'displayName' | 'role'
        >[] = participants
          .filter(
            (participant) =>
              !existingParticipantsBasedOnMessageIds.find(
                (existingParticipant) =>
                  existingParticipant.messageId === participant.messageId &&
                  existingParticipant.handle === participant.handle &&
                  existingParticipant.displayName === participant.displayName &&
                  existingParticipant.role === participant.role,
              ),
          )
          .map((participant) => {
            return {
              messageId: participant.messageId,
              handle: participant.handle,
              displayName: participant.displayName,
              role: participant.role,
            };
          });

        const createdParticipants = await messageParticipantRepository.insert(
          participantsToCreate,
          transactionManager,
        );

        return this.matchParticipantService.matchParticipants({
          participants: createdParticipants.raw ?? [],
          objectMetadataName: 'messageParticipant',
          transactionManager,
          // The caller owns the import transaction and emits only after its
          // commit, when the message and channel association are visible to
          // reply listeners using a separate connection.
          shouldEmitMatchedEvent: false,
          matchWith: 'workspaceMemberAndPerson',
          workspaceId,
        });
      },
      authContext,
      { lite: true },
    );
  }

  public emitMessageParticipantsMatched(
    participants: MessageParticipantWorkspaceEntity[],
    workspaceId: string,
  ): void {
    this.matchParticipantService.emitParticipantsMatched({
      participants,
      objectMetadataName: 'messageParticipant',
      workspaceId,
    });
  }
}
