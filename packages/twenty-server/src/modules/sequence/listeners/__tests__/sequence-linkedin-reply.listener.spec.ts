import { type ObjectRecordCreateEvent } from 'twenty-shared/database-events';
import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
} from 'twenty-shared/types';

import { type FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

describe('SequenceLinkedinReplyListener', () => {
  const messageRepository = {
    find: jest.fn(),
  };
  const participantRepository = {
    find: jest.fn(),
  };
  const actionRepository = {
    find: jest.fn(),
  };
  const enrollmentRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(async (callback: () => Promise<void>) =>
      callback(),
    ),
    getRepository: jest.fn(
      async (_workspaceId: string, entity: string | object) => {
        if (entity === 'linkedinMessage') return messageRepository;
        if (entity === 'linkedinThreadParticipant') {
          return participantRepository;
        }
        if (entity === LinkedinActionWorkspaceEntity) return actionRepository;
        if (entity === SequenceEnrollmentWorkspaceEntity) {
          return enrollmentRepository;
        }

        throw new Error(`Unexpected repository ${String(entity)}`);
      },
    ),
  } as unknown as GlobalWorkspaceOrmManager;
  const featureFlagService = {
    isFeatureEnabled: jest.fn().mockResolvedValue(true),
  } as unknown as FeatureFlagService;
  const listener = new SequenceLinkedinReplyListener(
    featureFlagService,
    globalWorkspaceOrmManager,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    messageRepository.find.mockResolvedValue([
      {
        threadId: 'thread-id',
        deliveredAt: new Date('2026-07-24T12:00:00.000Z'),
        ownerWorkspaceMemberId: 'owner-id',
        senderLinkedinUrn: 'sender-urn',
      },
    ]);
    participantRepository.find.mockResolvedValue([
      {
        threadId: 'thread-id',
        linkedinUrn: 'sender-urn',
        personId: 'person-id',
        isSelf: false,
      },
    ]);
    actionRepository.find.mockResolvedValue([
      {
        id: 'action-id',
        personId: 'person-id',
        sequenceEnrollmentId: 'enrollment-id',
        ownerWorkspaceMemberId: 'owner-id',
        type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        executedAt: new Date('2026-07-24T11:00:00.000Z'),
      },
    ]);
    enrollmentRepository.find.mockResolvedValue([{ id: 'enrollment-id' }]);
    enrollmentRepository.findOne.mockResolvedValue({
      id: 'enrollment-id',
      status: 'REPLIED',
    });
    enrollmentRepository.update.mockResolvedValue({ affected: 1 });
  });

  it('stops the enrollment when the same LinkedIn owner receives a message after its sequence action', async () => {
    await listener.handleMessageCreatedEvent(buildMessageCreatedPayload());

    expect(actionRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: expect.objectContaining({
            _type: 'in',
            _value: [
              LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
              LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
            ],
          }),
        }),
      }),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({ value: ['enrollment-id'] }),
      }),
      expect.objectContaining({
        status: 'REPLIED',
        waitingOn: null,
        nextActionAt: null,
      }),
    );
  });

  it('guards the final reply update when an eligible enrollment concurrently becomes terminal', async () => {
    await listener.handleMessageCreatedEvent(buildMessageCreatedPayload());

    expect(enrollmentRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({
            _type: 'in',
            _value: [
              SEQUENCE_ENROLLMENT_STATUSES.PENDING,
              SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            ],
          }),
          stopOnReply: true,
        }),
      }),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({ _value: ['enrollment-id'] }),
        status: expect.objectContaining({
          _type: 'in',
          _value: [
            SEQUENCE_ENROLLMENT_STATUSES.PENDING,
            SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          ],
        }),
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
      }),
    );
  });

  it('stops the enrollment when the reply follows a connection-request note', async () => {
    actionRepository.find.mockResolvedValue([
      {
        personId: 'person-id',
        sequenceEnrollmentId: 'enrollment-id',
        ownerWorkspaceMemberId: 'owner-id',
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        executedAt: new Date('2026-07-24T11:00:00.000Z'),
      },
    ]);

    await listener.handleMessageCreatedEvent(buildMessageCreatedPayload());

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'REPLIED' }),
    );
  });

  it('does not treat another LinkedIn account conversation as a reply', async () => {
    messageRepository.find.mockResolvedValue([
      {
        threadId: 'thread-id',
        deliveredAt: new Date('2026-07-24T12:00:00.000Z'),
        ownerWorkspaceMemberId: 'other-owner-id',
        senderLinkedinUrn: 'sender-urn',
      },
    ]);

    await listener.handleMessageCreatedEvent(buildMessageCreatedPayload());

    expect(enrollmentRepository.find).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not stop another participant enrollment in a group conversation', async () => {
    participantRepository.find.mockResolvedValue([
      {
        threadId: 'thread-id',
        linkedinUrn: 'sender-urn',
        personId: 'sender-person-id',
        isSelf: false,
      },
      {
        threadId: 'thread-id',
        linkedinUrn: 'other-person-urn',
        personId: 'person-id',
        isSelf: false,
      },
    ]);

    await listener.handleMessageCreatedEvent(buildMessageCreatedPayload());

    expect(enrollmentRepository.find).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it.each([
    LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
    LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
  ])(
    'reprocesses an inbound message committed before its %s completion report',
    async (type) => {
      actionRepository.find.mockResolvedValueOnce([]);

      await listener.handleMessageCreatedEvent(buildMessageCreatedPayload());

      expect(enrollmentRepository.update).not.toHaveBeenCalled();

      // The terminal update event is emitted before its transaction commits,
      // so the reconciliation read can still see no completed action.
      actionRepository.find.mockResolvedValue([]);

      await listener.reconcileCompletedOutboundActions({
        actions: [
          {
            id: 'action-id',
            personId: 'person-id',
            sequenceEnrollmentId: 'enrollment-id',
            ownerWorkspaceMemberId: 'owner-id',
            type,
            status: LINKEDIN_ACTION_STATUSES.COMPLETED,
            executedAt: new Date('2026-07-24T11:00:00.000Z'),
          } as LinkedinActionWorkspaceEntity,
        ],
        workspaceId: 'workspace-id',
      });

      expect(enrollmentRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'REPLIED' }),
      );
    },
  );

  it('replays a committed inbound reply for one enrollment before provider start', async () => {
    await expect(
      listener.reconcileEnrollmentBeforeProviderStart({
        sequenceEnrollmentId: 'enrollment-id',
        workspaceId: 'workspace-id',
      }),
    ).resolves.toBe(true);

    expect(actionRepository.find).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          sequenceEnrollmentId: 'enrollment-id',
          status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        }),
      }),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'REPLIED' }),
    );
    expect(enrollmentRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'enrollment-id' },
      select: ['id', 'status'],
    });
  });

  const buildMessageCreatedPayload = (): WorkspaceEventBatch<
    ObjectRecordCreateEvent<LinkedinMessageWorkspaceEntity>
  > => ({
    events: [
      {
        recordId: 'message-id',
        properties: {
          after: {
            id: 'message-id',
            direction: 'INBOUND',
            threadId: 'thread-id',
          } as LinkedinMessageWorkspaceEntity,
        },
      } as ObjectRecordCreateEvent<LinkedinMessageWorkspaceEntity>,
    ],
    name: 'linkedinMessage',
    objectMetadata: {} as FlatObjectMetadata,
    workspaceId: 'workspace-id',
  });
});
