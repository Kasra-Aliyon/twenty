import { MessageParticipantRole } from 'twenty-shared/types';

import { type FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { SequenceReplyListener } from 'src/modules/sequence/listeners/sequence-reply.listener';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

describe('SequenceReplyListener', () => {
  it('exits only the person attached to an incoming FROM participant', async () => {
    const associationRepository = {
      find: jest.fn().mockResolvedValue([
        {
          messageId: 'incoming-message-id',
          messageThreadExternalId: 'replied-thread-id',
        },
      ]),
    };
    const enrollmentRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'replied-enrollment-id',
          personId: 'incoming-person-id',
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: new Date().toISOString(),
            },
          },
        },
        {
          id: 'unrelated-enrollment-id',
          personId: 'incoming-person-id',
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'other-header-message-id',
              threadExternalId: 'unrelated-thread-id',
              sentAt: new Date().toISOString(),
            },
          },
        },
      ]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const repositories = new Map<object, object>([
      [MessageChannelMessageAssociationWorkspaceEntity, associationRepository],
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
    ]);
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<void>) => callback(),
      ),
      getRepository: jest.fn(
        async (_workspaceId: string, entity: object) =>
          repositories.get(entity) ?? {},
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const featureFlagService = {
      isFeatureEnabled: jest.fn().mockResolvedValue(true),
    } as unknown as FeatureFlagService;
    const listener = new SequenceReplyListener(
      featureFlagService,
      globalWorkspaceOrmManager,
    );
    const participant = ({
      messageId,
      personId,
      role,
    }: {
      messageId: string;
      personId: string;
      role: MessageParticipantRole;
    }) => ({ messageId, personId, role }) as MessageParticipantWorkspaceEntity;
    const batchEvent = {
      name: 'messageParticipant_matched',
      workspaceId: 'workspace-id',
      events: [
        {
          workspaceMemberId: 'workspace-member-id',
          participants: [
            participant({
              messageId: 'incoming-message-id',
              personId: 'incoming-person-id',
              role: MessageParticipantRole.FROM,
            }),
            participant({
              messageId: 'outgoing-message-id',
              personId: 'outgoing-person-id',
              role: MessageParticipantRole.FROM,
            }),
            participant({
              messageId: 'incoming-message-id',
              personId: 'recipient-person-id',
              role: MessageParticipantRole.TO,
            }),
          ],
        },
      ],
    } satisfies CustomWorkspaceEventBatch<{
      workspaceMemberId: string;
      participants: MessageParticipantWorkspaceEntity[];
    }>;

    await listener.handleMessageParticipantMatched(batchEvent);

    expect(associationRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ direction: 'INCOMING' }),
      }),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    const findCriteria = enrollmentRepository.find.mock.calls[0][0].where as {
      personId: { value: string[] };
      stopOnReply: boolean;
    };
    const updateCriteria = enrollmentRepository.update.mock.calls[0][0] as {
      id: { value: string[] };
    };

    expect(findCriteria.personId.value).toEqual(['incoming-person-id']);
    expect(findCriteria.stopOnReply).toBe(true);
    expect(updateCriteria.id.value).toEqual(['replied-enrollment-id']);
  });

  it('does not resolve sequence repositories when the feature is disabled', async () => {
    const globalWorkspaceOrmManager = {
      getRepository: jest.fn(),
    } as unknown as GlobalWorkspaceOrmManager;
    const featureFlagService = {
      isFeatureEnabled: jest.fn().mockResolvedValue(false),
    } as unknown as FeatureFlagService;
    const listener = new SequenceReplyListener(
      featureFlagService,
      globalWorkspaceOrmManager,
    );

    await listener.handleMessageParticipantMatched({
      name: 'messageParticipant_matched',
      workspaceId: 'workspace-id',
      events: [],
    });

    expect(globalWorkspaceOrmManager.getRepository).not.toHaveBeenCalled();
  });
});
