import {
  MessageParticipantRole,
  SEQUENCE_ENROLLMENT_STATUSES,
} from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { type FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';
import { MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { SequenceReplyListener } from 'src/modules/sequence/listeners/sequence-reply.listener';
import { DEFAULT_SEQUENCE_SETTINGS } from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

type EnrollmentFixture = Pick<
  SequenceEnrollmentWorkspaceEntity,
  'id' | 'personId' | 'status' | 'stopOnReply' | 'sentEmailsByStepId'
> &
  Partial<
    Pick<
      SequenceEnrollmentWorkspaceEntity,
      'createdAt' | 'senderConnectedAccountId' | 'sequenceId'
    >
  >;

type AssociationFixture = {
  messageId: string;
  messageThreadExternalId: string | null;
  messageChannelId: string;
};

type MessageFixture = Pick<MessageWorkspaceEntity, 'id' | 'receivedAt'>;

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
      messageChannelId: 'message-channel-id',
    },
  ],
  messages = [
    {
      id: 'incoming-message-id',
      receivedAt: new Date('2026-08-17T10:00:00.000Z'),
    },
  ],
  messageChannels = [
    {
      id: 'message-channel-id',
      connectedAccountId: 'sender-account-id',
    },
  ],
  sequences = [],
}: {
  enrollments: EnrollmentFixture[];
  associations?: AssociationFixture[];
  messages?: MessageFixture[];
  messageChannels?: Pick<MessageChannelEntity, 'connectedAccountId' | 'id'>[];
  sequences?: Pick<
    SequenceWorkspaceEntity,
    'id' | 'senderConnectedAccountId' | 'settings'
  >[];
}) => {
  const associationRepository = {
    find: jest.fn().mockResolvedValue(associations),
  };
  const messageRepository = {
    find: jest.fn().mockResolvedValue(messages),
  };
  const normalizedEnrollments = enrollments.map((enrollment) => ({
    createdAt: '2026-08-14T10:00:00.000Z',
    sequenceId: 'sequence-id',
    senderConnectedAccountId: 'sender-account-id',
    ...enrollment,
  }));
  const enrollmentRepository = {
    find: jest.fn().mockResolvedValue(normalizedEnrollments),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const sequenceRepository = {
    find: jest.fn().mockResolvedValue(sequences),
  };
  const messageChannelRepository = {
    find: jest.fn().mockResolvedValue(messageChannels),
  };
  const repositories = new Map<object, object>([
    [MessageChannelMessageAssociationWorkspaceEntity, associationRepository],
    [MessageWorkspaceEntity, messageRepository],
    [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
    [SequenceWorkspaceEntity, sequenceRepository],
  ]);
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(async (callback: () => Promise<void>) =>
      callback(),
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
    messageChannelRepository as unknown as Repository<MessageChannelEntity>,
  );

  return {
    associationRepository,
    enrollmentRepository,
    listener,
    messageRepository,
    messageChannelRepository,
    sequenceRepository,
  };
};

describe('SequenceReplyListener', () => {
  it('reprocesses an inbound event after successful send metadata becomes durable', async () => {
    const enrollmentBeforeSend = {
      id: 'in-flight-reply-enrollment-id',
      personId: 'incoming-person-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      stopOnReply: true,
      senderConnectedAccountId: 'sender-account-id',
      sentEmailsByStepId: {},
    } satisfies EnrollmentFixture;
    const { enrollmentRepository, listener } = setup({
      enrollments: [enrollmentBeforeSend],
      associations: [
        {
          messageId: 'incoming-message-id',
          messageThreadExternalId: 'in-flight-thread-id',
          messageChannelId: 'message-channel-id',
        },
      ],
      messages: [
        {
          id: 'incoming-message-id',
          receivedAt: new Date('2026-08-17T10:00:05.000Z'),
        },
      ],
      messageChannels: [
        {
          id: 'message-channel-id',
          connectedAccountId: 'sender-account-id',
        },
      ],
    });
    const inboundParticipants = [
      participant({
        messageId: 'incoming-message-id',
        personId: 'incoming-person-id',
        role: MessageParticipantRole.FROM,
      }),
    ];
    const inboundEvent = buildBatchEvent(inboundParticipants);

    // The import event wins the race and initially sees no completed send.
    await listener.handleMessageParticipantMatched(inboundEvent);

    expect(enrollmentRepository.update).not.toHaveBeenCalled();

    enrollmentRepository.find.mockResolvedValue([
      {
        ...enrollmentBeforeSend,
        createdAt: '2026-08-14T10:00:00.000Z',
        sequenceId: 'sequence-id',
        sentEmailsByStepId: {
          'email-step-id': {
            headerMessageId: 'sent-header-message-id',
            threadExternalId: 'in-flight-thread-id',
            sentAt: '2026-08-17T10:00:00.000Z',
            connectedAccountId: 'sender-account-id',
          },
        },
      },
    ]);

    // The executor reconciliation boundary reuses the exact listener path
    // after successful send metadata is durable.
    await listener.reconcileMessageParticipants({
      workspaceId: 'workspace-id',
      participants: inboundParticipants,
      sequenceEnrollmentId: enrollmentBeforeSend.id,
    });

    expect(enrollmentRepository.find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: enrollmentBeforeSend.id,
          personId: expect.anything(),
        }),
      }),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(2);
    expect(
      enrollmentRepository.update.mock.calls[0][1].sentEmailsByStepId[
        'email-step-id'
      ].repliedAt,
    ).toBe('2026-08-17T10:00:05.000Z');
    expect(enrollmentRepository.update.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
      }),
    );
  });

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
          senderConnectedAccountId: 'other-sender-account-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'other-header-message-id',
              threadExternalId: 'unrelated-thread-id',
              sentAt: '2026-08-16T10:00:00.000Z',
              connectedAccountId: 'other-sender-account-id',
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
    const attributedEmails =
      enrollmentRepository.update.mock.calls[0][1].sentEmailsByStepId;

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
    const stoppedEnrollmentIds = enrollmentRepository.update.mock.calls[1][0].id
      .value as string[];

    expect(stoppedEnrollmentIds).toEqual(['replied-enrollment-id']);
  });

  it('does not stop for a historical email whose own policy disabled stop-on-reply', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'historical-stop-disabled-enrollment-id',
          personId: 'incoming-person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'replied-email-step-id': {
              headerMessageId: 'replied-header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
              stopOnReply: false,
            },
            'later-email-step-id': {
              headerMessageId: 'later-header-message-id',
              threadExternalId: 'later-thread-id',
              sentAt: '2026-08-16T10:00:00.000Z',
              stopOnReply: true,
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

    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    expect(
      enrollmentRepository.update.mock.calls[0][1].sentEmailsByStepId[
        'replied-email-step-id'
      ].repliedAt,
    ).toEqual(expect.any(String));
    expect(enrollmentRepository.update.mock.calls[0][1].status).toBeUndefined();
  });

  it('stops for a historical email whose own policy enabled stop-on-reply', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'historical-stop-enabled-enrollment-id',
          personId: 'incoming-person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: false,
          sentEmailsByStepId: {
            'replied-email-step-id': {
              headerMessageId: 'replied-header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
              stopOnReply: true,
            },
            'later-email-step-id': {
              headerMessageId: 'later-header-message-id',
              threadExternalId: 'later-thread-id',
              sentAt: '2026-08-16T10:00:00.000Z',
              stopOnReply: false,
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
    expect(enrollmentRepository.update.mock.calls[1][1]).toEqual(
      expect.objectContaining({ status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED }),
    );
  });

  it('does not attribute a matching thread received through another mailbox', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'other-mailbox-thread-enrollment-id',
          personId: 'incoming-person-id',
          senderConnectedAccountId: 'sending-account-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'sent-header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
              connectedAccountId: 'sending-account-id',
            },
          },
        },
      ],
      messageChannels: [
        {
          id: 'message-channel-id',
          connectedAccountId: 'receiving-account-id',
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

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
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

  it('does not attribute a historical message that predates the sequence email in the same thread', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'later-email-enrollment-id',
          personId: 'incoming-person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
            },
          },
        },
      ],
      messages: [
        {
          id: 'incoming-message-id',
          receivedAt: new Date('2026-08-13T10:00:00.000Z'),
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

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not attribute a thread message without a trustworthy received time', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'unknown-time-enrollment-id',
          personId: 'incoming-person-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'header-message-id',
              threadExternalId: 'replied-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
            },
          },
        },
      ],
      messages: [{ id: 'incoming-message-id', receivedAt: null }],
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

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('refetches and merges a concurrent send when the attribution CAS loses', async () => {
    const enrollment: EnrollmentFixture = {
      id: 'continuing-enrollment-id',
      personId: 'incoming-person-id',
      senderConnectedAccountId: 'sender-account-id',
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
    const mergedEmails =
      enrollmentRepository.update.mock.calls[1][1].sentEmailsByStepId;

    expect(mergedEmails['concurrent-email-step-id']).toEqual(
      concurrentEnrollment.sentEmailsByStepId['concurrent-email-step-id'],
    );
    expect(mergedEmails['replied-email-step-id'].repliedAt).toEqual(
      expect.any(String),
    );
  });

  it('stops an open enrollment when the sender receives a reply in a fresh thread', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'fresh-thread-enrollment-id',
          personId: 'incoming-person-id',
          sequenceId: 'sequence-id',
          senderConnectedAccountId: 'sender-account-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'sent-header-message-id',
              threadExternalId: 'original-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
              connectedAccountId: 'sender-account-id',
            },
          },
        },
      ],
      associations: [
        {
          messageId: 'incoming-message-id',
          messageThreadExternalId: 'fresh-thread-id',
          messageChannelId: 'message-channel-id',
        },
      ],
      messageChannels: [
        {
          id: 'message-channel-id',
          connectedAccountId: 'sender-account-id',
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

    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({ value: ['fresh-thread-enrollment-id'] }),
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
      }),
    );
  });

  it('uses the latest email policy for a reply received in a fresh thread', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'fresh-thread-stop-disabled-enrollment-id',
          personId: 'incoming-person-id',
          senderConnectedAccountId: 'sender-account-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'sent-header-message-id',
              threadExternalId: 'original-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
              connectedAccountId: 'sender-account-id',
              stopOnReply: false,
            },
          },
        },
      ],
      associations: [
        {
          messageId: 'incoming-message-id',
          messageThreadExternalId: 'fresh-thread-id',
          messageChannelId: 'message-channel-id',
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

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not stop an enrollment when a fresh-thread reply arrived in another mailbox', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'other-sender-enrollment-id',
          personId: 'incoming-person-id',
          senderConnectedAccountId: 'sequence-sender-account-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'sent-header-message-id',
              threadExternalId: 'original-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
              connectedAccountId: 'sequence-sender-account-id',
            },
          },
        },
      ],
      messageChannels: [
        {
          id: 'message-channel-id',
          connectedAccountId: 'unrelated-account-id',
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

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not stop an enrollment for a message received before its completed send', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'new-enrollment-id',
          createdAt: '2026-08-14T10:00:00.000Z',
          personId: 'incoming-person-id',
          senderConnectedAccountId: 'sender-account-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'sent-header-message-id',
              threadExternalId: 'original-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
              connectedAccountId: 'sender-account-id',
            },
          },
        },
      ],
      messages: [
        {
          id: 'incoming-message-id',
          receivedAt: new Date('2026-08-13T10:00:00.000Z'),
        },
      ],
      messageChannels: [
        {
          id: 'message-channel-id',
          connectedAccountId: 'sender-account-id',
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

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not stop a pending pooled-sender enrollment before its first send', async () => {
    const { enrollmentRepository, listener, sequenceRepository } = setup({
      enrollments: [
        {
          id: 'pooled-sender-enrollment-id',
          personId: 'incoming-person-id',
          sequenceId: 'sequence-id',
          senderConnectedAccountId: null,
          status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
          stopOnReply: true,
          sentEmailsByStepId: {},
        },
      ],
      messageChannels: [
        {
          id: 'message-channel-id',
          connectedAccountId: 'pooled-sender-account-id',
        },
      ],
      sequences: [
        {
          id: 'sequence-id',
          senderConnectedAccountId: null,
          settings: {
            ...DEFAULT_SEQUENCE_SETTINGS,
            senderConnectedAccountIds: [
              'other-pool-account-id',
              'pooled-sender-account-id',
            ],
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

    expect(sequenceRepository.find).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not stop an active enrollment before its first completed send', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'pre-send-enrollment-id',
          personId: 'incoming-person-id',
          senderConnectedAccountId: 'sender-account-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {},
        },
      ],
      messageChannels: [
        {
          id: 'message-channel-id',
          connectedAccountId: 'sender-account-id',
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

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('stops a pooled-sender enrollment after that mailbox completed a send', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'sent-pooled-enrollment-id',
          personId: 'incoming-person-id',
          sequenceId: 'sequence-id',
          senderConnectedAccountId: 'pooled-sender-account-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'sent-header-message-id',
              threadExternalId: 'original-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
              connectedAccountId: 'pooled-sender-account-id',
            },
          },
        },
      ],
      messageChannels: [
        {
          id: 'message-channel-id',
          connectedAccountId: 'pooled-sender-account-id',
        },
      ],
      sequences: [
        {
          id: 'sequence-id',
          senderConnectedAccountId: null,
          settings: {
            ...DEFAULT_SEQUENCE_SETTINGS,
            senderConnectedAccountIds: [
              'other-pool-account-id',
              'pooled-sender-account-id',
            ],
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

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({ value: ['sent-pooled-enrollment-id'] }),
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
      }),
    );
  });

  it('does not stop a pooled enrollment when another pool mailbox receives the reply', async () => {
    const { enrollmentRepository, listener } = setup({
      enrollments: [
        {
          id: 'other-pool-mailbox-enrollment-id',
          personId: 'incoming-person-id',
          sequenceId: 'sequence-id',
          senderConnectedAccountId: 'sending-pool-account-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          stopOnReply: true,
          sentEmailsByStepId: {
            'email-step-id': {
              headerMessageId: 'sent-header-message-id',
              threadExternalId: 'original-thread-id',
              sentAt: '2026-08-15T10:00:00.000Z',
              connectedAccountId: 'sending-pool-account-id',
            },
          },
        },
      ],
      messageChannels: [
        {
          id: 'message-channel-id',
          connectedAccountId: 'receiving-pool-account-id',
        },
      ],
      sequences: [
        {
          id: 'sequence-id',
          senderConnectedAccountId: null,
          settings: {
            ...DEFAULT_SEQUENCE_SETTINGS,
            senderConnectedAccountIds: [
              'sending-pool-account-id',
              'receiving-pool-account-id',
            ],
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

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
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
      {} as Repository<MessageChannelEntity>,
    );

    await listener.handleMessageParticipantMatched({
      name: 'messageParticipant_matched',
      workspaceId: 'workspace-id',
      events: [],
    });

    expect(globalWorkspaceOrmManager.getRepository).not.toHaveBeenCalled();
  });
});
