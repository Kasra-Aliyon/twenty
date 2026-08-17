import {
  MessageParticipantRole,
  SEQUENCE_ENROLLMENT_STATUSES,
} from 'twenty-shared/types';

import { type FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { SequenceReplyListener } from 'src/modules/sequence/listeners/sequence-reply.listener';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

type EnrollmentFixture = Pick<
  SequenceEnrollmentWorkspaceEntity,
  'id' | 'personId' | 'status' | 'stopOnReply' | 'sentEmailsByStepId'
>;

const participant = ({
  messageId,
  personId,
  role,
}: {
  messageId: string;
  personId: string;
  role: MessageParticipantRole;
}) => ({ messageId, personId, role }) as MessageParticipantWorkspaceEntity;

const buildBatchEvent = (
  participants: MessageParticipantWorkspaceEntity[],
): CustomWorkspaceEventBatch<{
  workspaceMemberId: string;
  participants: MessageParticipantWorkspaceEntity[];
}> => ({
  name: 'messageParticipant_matched',
  workspaceId: 'workspace-id',
  events: [{ workspaceMemberId: 'workspace-member-id', participants }],
});

const setup = ({
  enrollments,
  associations = [
    {
      messageId: 'incoming-message-id',
      messageThreadExternalId: 'replied-thread-id',
    },
  ],
}: {
  enrollments: EnrollmentFixture[];
  associations?: { messageId: string; messageThreadExternalId: string }[];
}) => {
  const associationRepository = {
    find: jest.fn().mockResolvedValue(associations),
  };
  const enrollmentRepository = {
    find: jest.fn().mockResolvedValue(enrollments),
    findOne: jest.fn(),
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

  return { associationRepository, enrollmentRepository, listener };
};

describe('SequenceReplyListener', () => {
  it('attributes the latest email in the thread and stops an open stop-enabled enrollment', async () => {
    const { associationRepository, enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'replied-enrollment-id',
          personId: 'incoming-person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'older-email-step-id': {
              headerMessageId: 'older-header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
            },
            'latest-email-step-id': {
              headerMessageId: 'latest-header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: '2026-08-16T10:00:00.000Z',
            },
          },
        },
        {
          id: 'unrelated-enrollment-id',
          personId: 'incoming-person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'other-header-message-id',
              threadExternalId: 'unrelated-thread-id',
              sentAt: '2026-08-16T10:00:00.000Z',
            },
          },
        },
      ],
    });

    await listener.handleMessageParticipantMatched(
      buildBatchEvent([
        participant({
          messageId: 'incoming-message-id',
          personId: 'incoming-person-id',
          role: MessageParticipantRole.FROM,
        }),
        participant({
          messageId: 'incoming-message-id',
          personId: 'recipient-person-id',
          role: MessageParticipantRole.TO,
        }),
      ]),
    );

    expect(associationRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ direction: 'INCOMING' }),
      }),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(2);
    expect(enrollmentRepository.update.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'replied-enrollment-id' }),
    );
    const attributedEmails = enrollmentRepository.update.mock.calls[0][1]
      .sentEmailsByStepId;

    expect(attributedEmails['older-email-step-id'].repliedAt).toBeUndefined();
    expect(attributedEmails['latest-email-step-id'].repliedAt).toEqual(
      expect.any(String),
    );
    expect(enrollmentRepository.update.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
        waitingOn: null,
        nextActionAt: null,
        endedAt: expect.any(Date),
      }),
    );
    const stoppedEnrollmentIds = enrollmentRepository.update.mock.calls[1][0]
      .id.value as string[];

    expect(stoppedEnrollmentIds).toEqual(['replied-enrollment-id']);
  });

  it('attributes stop-disabled and completed enrollments without changing lifecycle state', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'continuing-enrollment-id',
          personId: 'incoming-person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: false,
          sentEmailsByStepId: {
            'continuing-email-step-id': {
              headerMessageId: 'continuing-header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: '2026-08-16T10:00:00.000Z',
            },
          },
        },
        {
          id: 'completed-enrollment-id',
          personId: 'incoming-person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
          stopOnReply: true,
          sentEmailsByStepId: {
            'completed-email-step-id': {
              headerMessageId: 'completed-header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
            },
          },
        },
        {
          id: 'linkedin-replied-enrollment-id',
          personId: 'incoming-person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
          stopOnReply: true,
          sentEmailsByStepId: {
            'unrelated-email-step-id': {
              headerMessageId: 'unrelated-header-message-id',
              threadExternalId: 'unrelated-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
            },
          },
        },
      ],
    });

    await listener.handleMessageParticipantMatched(
      buildBatchEvent([
        participant({
          messageId: 'incoming-message-id',
          personId: 'incoming-person-id',
          role: MessageParticipantRole.FROM,
        }),
      ]),
    );

    expect(enrollmentRepository.update).toHaveBeenCalledTimes(2);

    for (const [, update] of enrollmentRepository.update.mock.calls) {
      expect(update.sentEmailsByStepId).toBeDefined();
      expect(update.status).toBeUndefined();
    }

    expect(
      enrollmentRepository.update.mock.calls.map(([criteria]) => criteria.id),
    ).toEqual(['continuing-enrollment-id', 'completed-enrollment-id']);
  });

  it('refetches and merges a concurrent send when the attribution CAS loses', async () => {
    const enrollment: EnrollmentFixture = {
      id: 'continuing-enrollment-id',
      personId: 'incoming-person-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      stopOnReply: false,
      sentEmailsByStepId: {
        'replied-email-step-id': {
          headerMessageId: 'replied-header-message-id',
          threadExternalId: 'replied-thread-id',
          sentAt: '2026-08-15T10:00:00.000Z',
        },
      },
    };
    const { enrollmentRepository, listener } = setup({
      enrollments: [enrollment],
    });
    const concurrentEnrollment = {
      ...enrollment,
      sentEmailsByStepId: {
        ...enrollment.sentEmailsByStepId,
        'concurrent-email-step-id': {
          headerMessageId: 'concurrent-header-message-id',
          threadExternalId: 'different-thread-id',
          sentAt: '2026-08-16T10:00:00.000Z',
        },
      },
    };

    enrollmentRepository.update
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 });
    enrollmentRepository.findOne.mockResolvedValue(concurrentEnrollment);

    await listener.handleMessageParticipantMatched(
      buildBatchEvent([
        participant({
          messageId: 'incoming-message-id',
          personId: 'incoming-person-id',
          role: MessageParticipantRole.FROM,
        }),
      ]),
    );

    expect(enrollmentRepository.findOne).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(2);
    const mergedEmails = enrollmentRepository.update.mock.calls[1][1]
      .sentEmailsByStepId;

    expect(mergedEmails['concurrent-email-step-id']).toEqual(
      concurrentEnrollment.sentEmailsByStepId['concurrent-email-step-id'],
    );
    expect(mergedEmails['replied-email-step-id'].repliedAt).toEqual(
      expect.any(String),
    );
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
