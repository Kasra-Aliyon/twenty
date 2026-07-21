import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
  type SequenceEnrollmentStatus,
} from 'twenty-shared/types';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceSchedulerService } from 'src/modules/sequence/services/sequence-scheduler.service';
import { DEFAULT_SEQUENCE_SETTINGS } from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

describe('SequenceSchedulerService', () => {
  const workspaceId = 'workspace-id';
  const now = new Date('2024-01-01T10:00:00.000Z');
  const sequence = {
    id: 'sequence-id',
    status: SEQUENCE_STATUSES.ACTIVE,
    senderConnectedAccountId: 'mailbox-id',
    settings: {
      ...DEFAULT_SEQUENCE_SETTINGS,
      activeDays: [1],
      windowStart: '00:00',
      windowEnd: '23:59',
      dailyStarts: 2,
      staggerMinutes: 5,
    },
  } as SequenceWorkspaceEntity;
  const step = {
    id: 'step-id',
    sequenceId: sequence.id,
    position: 0,
    type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
    settings: {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Hello',
      bodyHtml: '<p>Hello</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: null,
    },
  } as SequenceStepWorkspaceEntity;

  const buildEnrollment = (
    id: string,
    status: SequenceEnrollmentStatus = SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
  ) =>
    ({
      id,
      sequenceId: sequence.id,
      personId: `${id}-person`,
      status,
      currentStepPosition: -1,
      currentStepId: null,
      waitingOn:
        status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE
          ? SEQUENCE_WAITING_ON.DELAY
          : null,
      nextActionAt: status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE ? now : null,
      senderConnectedAccountId: 'mailbox-id',
      sentEmailsByStepId: {},
    }) as SequenceEnrollmentWorkspaceEntity;

  const setup = ({
    startedToday,
    pendingEnrollments = [],
    dueEnrollments = [],
    futureScheduledEnrollments = [],
  }: {
    startedToday: number;
    pendingEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    dueEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    futureScheduledEnrollments?: SequenceEnrollmentWorkspaceEntity[];
  }) => {
    const sequenceRepository = {
      find: jest.fn().mockResolvedValue([sequence]),
    };
    const enrollmentRepository = {
      count: jest.fn().mockResolvedValue(startedToday),
      find: jest.fn().mockImplementation(async (options) => {
        if (options.where.status === SEQUENCE_ENROLLMENT_STATUSES.PENDING) {
          return pendingEnrollments;
        }

        if (options.where.waitingOn === SEQUENCE_WAITING_ON.EMAIL_SCHEDULED) {
          return futureScheduledEnrollments;
        }

        return dueEnrollments;
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepository = {
      find: jest.fn().mockResolvedValue([step]),
    };
    const repositories = new Map<object, object>([
      [SequenceWorkspaceEntity, sequenceRepository],
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceStepWorkspaceEntity, stepRepository],
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
    const enqueueProcess = jest.fn();
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;
    const acquireSendLock = jest.fn().mockResolvedValue(true);
    const releaseSendLock = jest.fn();
    const sequenceMailboxThrottleService = {
      acquireSendLock,
      releaseSendLock,
      getLastSendAt: jest
        .fn()
        .mockResolvedValue(new Date('2024-01-01T09:55:00.000Z')),
    } as unknown as SequenceMailboxThrottleService;
    const service = new SequenceSchedulerService(
      globalWorkspaceOrmManager,
      sequenceQueueService,
      sequenceMailboxThrottleService,
    );

    return {
      service,
      enrollmentRepository,
      enqueueProcess,
      acquireSendLock,
      releaseSendLock,
    };
  };

  it('admits only the remaining daily starts', async () => {
    const pendingEnrollment = buildEnrollment(
      'pending-id',
      SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    );
    const { service, enrollmentRepository } = setup({
      startedToday: 1,
      pendingEnrollments: [pendingEnrollment],
    });

    await service.tick(workspaceId, now);

    const pendingFindCall = enrollmentRepository.find.mock.calls.find(
      ([options]) =>
        options.where.status === SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    );

    expect(pendingFindCall?.[0]).toEqual(expect.objectContaining({ take: 1 }));
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: pendingEnrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        nextActionAt: now,
      }),
    );
  });

  it('enqueues one due email and reserves the next staggered slot', async () => {
    const firstEnrollment = buildEnrollment('first-id');
    const secondEnrollment = buildEnrollment('second-id');
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 2,
      dueEnrollments: [firstEnrollment, secondEnrollment],
    });

    await service.tick(workspaceId, now);

    expect(enqueueProcess).toHaveBeenCalledTimes(1);
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: firstEnrollment.id,
    });
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: firstEnrollment.id }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: now,
      }),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: secondEnrollment.id }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date('2024-01-01T10:05:00.000Z'),
      }),
    );
  });

  it('does not enqueue when the scheduling authorization loses its CAS', async () => {
    const dueEnrollment = buildEnrollment('due-id');
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 2,
      dueEnrollments: [dueEnrollment],
    });

    enrollmentRepository.update.mockResolvedValueOnce({ affected: 0 });

    await service.tick(workspaceId, now);

    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('allocates around another active sequence reservation', async () => {
    const dueEnrollment = buildEnrollment('due-id');
    const reservedEnrollment = {
      ...buildEnrollment('reserved-id'),
      waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      nextActionAt: new Date('2024-01-01T10:03:00.000Z'),
    };
    const { service, enrollmentRepository } = setup({
      startedToday: 2,
      dueEnrollments: [dueEnrollment],
      futureScheduledEnrollments: [reservedEnrollment],
    });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: dueEnrollment.id }),
      expect.objectContaining({
        nextActionAt: new Date('2024-01-01T10:08:00.000Z'),
      }),
    );
  });

  it('serializes mailbox allocation with the send lock', async () => {
    const dueEnrollment = buildEnrollment('due-id');
    const { service, enqueueProcess, acquireSendLock, releaseSendLock } = setup(
      {
        startedToday: 2,
        dueEnrollments: [dueEnrollment],
      },
    );

    await service.tick(workspaceId, now);

    expect(acquireSendLock).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'mailbox-id',
    });
    expect(releaseSendLock).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'mailbox-id',
    });
    expect(acquireSendLock.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueProcess.mock.invocationCallOrder[0],
    );
    expect(enqueueProcess.mock.invocationCallOrder[0]).toBeLessThan(
      releaseSendLock.mock.invocationCallOrder[0],
    );
  });
});
