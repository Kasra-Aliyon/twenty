import {
  MessageParticipantRole,
  SEQUENCE_ENROLLMENT_STATUSES,
} from 'twenty-shared/types';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type SequenceReplyListener } from 'src/modules/sequence/listeners/sequence-reply.listener';
import { SequenceEmailReplyReconciliationService } from 'src/modules/sequence/services/sequence-email-reply-reconciliation.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

describe('SequenceEmailReplyReconciliationService', () => {
  const workspaceId = 'workspace-id';
  const earliestSentAt = '2026-08-16T10:00:00.000Z';
  const enrollment = {
    id: 'enrollment-id',
    personId: 'person-id',
    sentEmailsByStepId: {
      'later-step-id': {
        headerMessageId: 'later-header-message-id',
        threadExternalId: 'later-thread-id',
        sentAt: '2026-08-17T10:00:00.000Z',
      },
      'earlier-step-id': {
        headerMessageId: 'earlier-header-message-id',
        threadExternalId: 'earlier-thread-id',
        sentAt: earliestSentAt,
      },
    },
  } satisfies Pick<
    SequenceEnrollmentWorkspaceEntity,
    'id' | 'personId' | 'sentEmailsByStepId'
  >;

  const setup = () => {
    const participant = {
      id: 'participant-id',
      createdAt: '2026-08-16T10:05:00.000Z',
      messageId: 'message-id',
      personId: enrollment.personId,
      role: MessageParticipantRole.FROM,
      workspaceMemberId: null,
    } as MessageParticipantWorkspaceEntity;
    const messageParticipantRepository = {
      find: jest.fn().mockResolvedValue([participant]),
    };
    const globalWorkspaceOrmManager = {
      getRepository: jest.fn().mockResolvedValue(messageParticipantRepository),
    } as unknown as GlobalWorkspaceOrmManager;
    const reconcileMessageParticipants = jest.fn();
    const sequenceReplyListener = {
      reconcileMessageParticipants,
    } as unknown as SequenceReplyListener;
    const enrollmentFindOne = jest.fn().mockResolvedValue({
      id: enrollment.id,
      status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
    });
    const enrollmentRepository = {
      findOne: enrollmentFindOne,
    } as unknown as WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    const service = new SequenceEmailReplyReconciliationService(
      globalWorkspaceOrmManager,
      sequenceReplyListener,
    );

    return {
      enrollmentFindOne,
      enrollmentRepository,
      messageParticipantRepository,
      participant,
      reconcileMessageParticipants,
      service,
    };
  };

  it('replays durable inbound participants since the earliest successful send and observes REPLIED', async () => {
    const {
      enrollmentRepository,
      enrollmentFindOne,
      messageParticipantRepository,
      participant,
      reconcileMessageParticipants,
      service,
    } = setup();

    await expect(
      service.reconcileBeforeEnrollmentProgress({
        workspaceId,
        enrollment,
        enrollmentRepository,
      }),
    ).resolves.toBe(true);

    const participantFindOptions =
      messageParticipantRepository.find.mock.calls[0][0];

    expect(participantFindOptions.where).toEqual(
      expect.objectContaining({
        personId: enrollment.personId,
        role: MessageParticipantRole.FROM,
      }),
    );
    expect(participantFindOptions.where.createdAt.value).toBe(earliestSentAt);
    expect(reconcileMessageParticipants).toHaveBeenCalledWith({
      workspaceId,
      participants: [participant],
      sequenceEnrollmentId: enrollment.id,
    });
    expect(enrollmentFindOne).toHaveBeenCalledWith({
      where: { id: enrollment.id },
      select: ['id', 'status'],
    });
  });

  it('does not scan participants before an enrollment has sent successfully', async () => {
    const {
      enrollmentRepository,
      messageParticipantRepository,
      reconcileMessageParticipants,
      service,
    } = setup();

    await expect(
      service.reconcileBeforeEnrollmentProgress({
        workspaceId,
        enrollment: {
          ...enrollment,
          sentEmailsByStepId: {},
        },
        enrollmentRepository,
      }),
    ).resolves.toBe(false);

    expect(messageParticipantRepository.find).not.toHaveBeenCalled();
    expect(reconcileMessageParticipants).not.toHaveBeenCalled();
  });
});
