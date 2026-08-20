import {
  SEQUENCE_ENROLLMENT_STATUSES,
  type SequenceEnrollmentStatus,
} from 'twenty-shared/types';

import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { type SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { type SequenceLinkedinInvitationReconcilerService } from 'src/modules/sequence/services/sequence-linkedin-invitation-reconciler.service';
import { type SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { type SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { type SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceSchedulerService } from 'src/modules/sequence/services/sequence-scheduler.service';
import { type SequenceTaskCompletionService } from 'src/modules/sequence/services/sequence-task-completion.service';
import { SEQUENCE_SCHEDULER_BATCH_SIZE } from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

type SchedulerDeliveredRecoveryHarness = {
  enqueueDeliveredEmailCheckpointRecoveries(args: {
    workspaceId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
  }): Promise<void>;
};

describe('SequenceSchedulerService delivered email checkpoint recovery', () => {
  const workspaceId = 'workspace-id';
  const stepId = 'email-step-id';
  const deliveredEmail = {
    stepPosition: 0,
    metadata: {
      headerMessageId: 'header-message-id',
      threadExternalId: 'thread-external-id',
      sentAt: '2026-08-20T10:00:00.000Z',
    },
  };
  const buildEnrollment = ({
    id,
    status,
    includeCheckpoint = true,
    sentEmailsByStepId = {},
  }: {
    id: string;
    status: SequenceEnrollmentStatus;
    includeCheckpoint?: boolean;
    sentEmailsByStepId?: SequenceEnrollmentWorkspaceEntity['sentEmailsByStepId'];
  }) =>
    ({
      id,
      status,
      sentEmailsByStepId,
      lastSendAttempt: {
        stepId,
        attemptedAt: '2026-08-20T10:00:00.000Z',
        providerStartedAt: '2026-08-20T10:00:00.000Z',
        dailyReservation: {
          mailboxId: 'mailbox-id',
          token: `${id}-token`,
          usageDate: '2026-08-20',
        },
        ...(includeCheckpoint ? { deliveredEmail } : {}),
      },
    }) as SequenceEnrollmentWorkspaceEntity;

  it('boundedly enqueues unattributed delivered checkpoints across active and terminal states only', async () => {
    const pausedSequenceEnrollment = buildEnrollment({
      id: 'paused-sequence-active-enrollment-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
    });
    const terminalEnrollment = buildEnrollment({
      id: 'terminal-enrollment-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
    });
    const providerStartedWithoutDelivery = buildEnrollment({
      id: 'provider-started-without-delivery-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
      includeCheckpoint: false,
    });
    const alreadyAttributed = buildEnrollment({
      id: 'already-attributed-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
      sentEmailsByStepId: {
        [stepId]: deliveredEmail.metadata,
      },
    });
    const enrollmentRepository = {
      find: jest
        .fn()
        .mockResolvedValue([
          pausedSequenceEnrollment,
          terminalEnrollment,
          providerStartedWithoutDelivery,
          alreadyAttributed,
        ]),
    } as unknown as WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
    const enqueueProcess = jest.fn();
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;
    const service = new SequenceSchedulerService(
      {} as never,
      sequenceQueueService,
      {} as SequenceMailboxThrottleService,
      {} as SequenceTaskCompletionService,
      {} as SequenceLinkedinInvitationReconcilerService,
      {} as SequenceLinkedinThrottleService,
      {} as SequenceLinkedinReplyListener,
      {} as SequenceMetricsService,
    );

    await (
      service as unknown as SchedulerDeliveredRecoveryHarness
    ).enqueueDeliveredEmailCheckpointRecoveries({
      workspaceId,
      enrollmentRepository,
    });

    expect(enrollmentRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: SEQUENCE_SCHEDULER_BATCH_SIZE,
        order: { updatedAt: 'ASC', id: 'ASC' },
        where: expect.objectContaining({
          lastSendAttempt: expect.objectContaining({ _type: 'raw' }),
          sentEmailsByStepId: expect.objectContaining({ _type: 'raw' }),
        }),
      }),
    );
    expect(enqueueProcess).toHaveBeenCalledTimes(2);
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: pausedSequenceEnrollment.id,
    });
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: terminalEnrollment.id,
    });
    expect(enqueueProcess).not.toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentId: providerStartedWithoutDelivery.id,
      }),
    );
  });
});
