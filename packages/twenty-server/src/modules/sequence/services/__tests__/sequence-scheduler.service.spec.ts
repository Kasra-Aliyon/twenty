import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
  type SequenceEnrollmentStatus,
  type SequenceSettings,
} from 'twenty-shared/types';
import { MoreThanOrEqual } from 'typeorm';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { type SequenceLinkedinInvitationReconcilerService } from 'src/modules/sequence/services/sequence-linkedin-invitation-reconciler.service';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceSchedulerService } from 'src/modules/sequence/services/sequence-scheduler.service';
import { type SequenceTaskCompletionService } from 'src/modules/sequence/services/sequence-task-completion.service';
import {
  DEFAULT_SEQUENCE_SETTINGS,
  SEQUENCE_SCHEDULER_BATCH_SIZE,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

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
      dailyStartLimitEnabled: true,
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
    linkedinWaitingEnrollments = [],
    linkedinActions = [],
    expiredClaimedActions = [],
    taskWaitingEnrollments = [],
    sequenceTasks = [],
    dailyStartLimitEnabled = true,
    senderPool,
    activeSenderAssignments = [],
    sequenceSettings = {},
    steps = [step],
    recipientTimeZones = {},
  }: {
    startedToday: number;
    pendingEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    dueEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    futureScheduledEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    linkedinWaitingEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    linkedinActions?: LinkedinActionWorkspaceEntity[];
    expiredClaimedActions?: LinkedinActionWorkspaceEntity[];
    taskWaitingEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    sequenceTasks?: Array<{
      sequenceEnrollmentId: string | null;
      sequenceStepId: string | null;
      status: string;
    }>;
    dailyStartLimitEnabled?: boolean;
    senderPool?: string[];
    activeSenderAssignments?: SequenceEnrollmentWorkspaceEntity[];
    sequenceSettings?: Partial<SequenceSettings>;
    steps?: SequenceStepWorkspaceEntity[];
    recipientTimeZones?: Record<string, string | null>;
  }) => {
    const activeSequence = {
      ...sequence,
      settings: {
        ...sequence.settings,
        ...sequenceSettings,
        dailyStartLimitEnabled,
        ...(senderPool === undefined
          ? {}
          : { senderConnectedAccountIds: senderPool }),
      },
    } as SequenceWorkspaceEntity;
    const sequenceRepository = {
      find: jest.fn().mockResolvedValue([activeSequence]),
      findOne: jest.fn().mockResolvedValue(activeSequence),
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

        if (options.where.waitingOn === SEQUENCE_WAITING_ON.LINKEDIN_ACTION) {
          return linkedinWaitingEnrollments;
        }

        if (options.where.updatedAt) {
          return taskWaitingEnrollments;
        }

        if ('senderConnectedAccountId' in options.where) {
          return activeSenderAssignments;
        }

        return dueEnrollments;
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepository = {
      find: jest.fn().mockResolvedValue(steps),
    };
    const personRepository = {
      find: jest.fn().mockResolvedValue(
        Object.entries(recipientTimeZones).map(([id, timeZone]) => ({
          id,
          timeZone,
        })),
      ),
    };
    const linkedinActionRepository = {
      find: jest.fn().mockImplementation(async (options) => {
        if (options.where.sequenceEnrollmentId) {
          return linkedinActions;
        }

        if (options.where.status === LINKEDIN_ACTION_STATUSES.CLAIMED) {
          return expiredClaimedActions;
        }

        return [];
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const taskRepository = {
      find: jest.fn().mockResolvedValue(sequenceTasks),
    };
    const repositories = new Map<object, object>([
      [SequenceWorkspaceEntity, sequenceRepository],
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceStepWorkspaceEntity, stepRepository],
      [PersonWorkspaceEntity, personRepository],
      [LinkedinActionWorkspaceEntity, linkedinActionRepository],
      [TaskWorkspaceEntity, taskRepository],
    ]);
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<void>) => callback(),
      ),
      getRepository: jest.fn(
        async (_workspaceId: string, entity: object) =>
          repositories.get(entity) ?? {},
      ),
      getGlobalWorkspaceDataSource: jest.fn().mockResolvedValue({
        transaction: jest.fn(async (callback) => callback({})),
      }),
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
    const completeTaskStep = jest.fn();
    const sequenceTaskCompletionService = {
      completeTaskStep,
    } as unknown as SequenceTaskCompletionService;
    const reconcileLinkedinInvitations = jest.fn();
    const sequenceLinkedinInvitationReconcilerService = {
      reconcile: reconcileLinkedinInvitations,
    } as unknown as SequenceLinkedinInvitationReconcilerService;
    const service = new SequenceSchedulerService(
      globalWorkspaceOrmManager,
      sequenceQueueService,
      sequenceMailboxThrottleService,
      sequenceTaskCompletionService,
      sequenceLinkedinInvitationReconcilerService,
    );

    return {
      service,
      sequenceRepository,
      enrollmentRepository,
      personRepository,
      linkedinActionRepository,
      enqueueProcess,
      acquireSendLock,
      releaseSendLock,
      completeTaskStep,
      reconcileLinkedinInvitations,
    };
  };

  it('does not retry a direct message whose claimed browser outcome is unknown', async () => {
    const expiredMessage = {
      id: 'message-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      attemptCount: 0,
    } as LinkedinActionWorkspaceEntity;
    const { service, linkedinActionRepository } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredMessage],
    });

    await service.tick(workspaceId, now);

    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expiredMessage.id }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        executedAt: now,
        errorMessage: 'LINKEDIN_ACTION_OUTCOME_UNKNOWN',
      }),
    );
  });

  it('requeues an expired connection claim because the runner rechecks live state', async () => {
    const expiredRequest = {
      id: 'request-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      attemptCount: 2,
    } as LinkedinActionWorkspaceEntity;
    const { service, linkedinActionRepository } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredRequest],
    });

    await service.tick(workspaceId, now);

    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expiredRequest.id }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        claimedAt: null,
        claimedBy: null,
        attemptCount: 3,
      }),
    );
  });

  it('admits only the remaining daily starts', async () => {
    const pendingEnrollment = buildEnrollment(
      'pending-id',
      SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    );
    const { service, sequenceRepository, enrollmentRepository } = setup({
      startedToday: 1,
      pendingEnrollments: [pendingEnrollment],
    });

    await service.tick(workspaceId, now);

    expect(sequenceRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: sequence.id,
          status: SEQUENCE_STATUSES.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      }),
      expect.any(Object),
    );

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
      expect.any(Object),
    );
  });

  it('admits pending enrollments without counting daily starts when the cap is disabled', async () => {
    const pendingEnrollments = [
      buildEnrollment('first-pending-id', SEQUENCE_ENROLLMENT_STATUSES.PENDING),
      buildEnrollment(
        'second-pending-id',
        SEQUENCE_ENROLLMENT_STATUSES.PENDING,
      ),
    ];
    const { service, enrollmentRepository } = setup({
      startedToday: 25,
      pendingEnrollments,
      dailyStartLimitEnabled: false,
    });

    await service.tick(workspaceId, now);

    const pendingFindCall = enrollmentRepository.find.mock.calls.find(
      ([options]) =>
        options.where.status === SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    );

    expect(enrollmentRepository.count).not.toHaveBeenCalled();
    expect(pendingFindCall?.[0]).toEqual(
      expect.objectContaining({ take: SEQUENCE_SCHEDULER_BATCH_SIZE }),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(
      pendingEnrollments.length,
    );
  });

  it('rotates new enrollments across the least-loaded sender pool', async () => {
    const pendingEnrollments = [
      {
        ...buildEnrollment(
          'first-pending-id',
          SEQUENCE_ENROLLMENT_STATUSES.PENDING,
        ),
        senderConnectedAccountId: 'mailbox-a',
      },
      {
        ...buildEnrollment(
          'second-pending-id',
          SEQUENCE_ENROLLMENT_STATUSES.PENDING,
        ),
        senderConnectedAccountId: 'mailbox-a',
      },
    ] as SequenceEnrollmentWorkspaceEntity[];
    const { service, enrollmentRepository } = setup({
      startedToday: 0,
      pendingEnrollments,
      dailyStartLimitEnabled: false,
      senderPool: ['mailbox-a', 'mailbox-b'],
    });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'first-pending-id' }),
      expect.objectContaining({ senderConnectedAccountId: 'mailbox-a' }),
      expect.any(Object),
    );
    expect(enrollmentRepository.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'second-pending-id' }),
      expect.objectContaining({ senderConnectedAccountId: 'mailbox-b' }),
      expect.any(Object),
    );
  });

  it('admits recipient-mode enrollments outside the fixed sequence window and counts the UTC quota day', async () => {
    const recipientNow = new Date('2024-01-01T22:30:00.000Z');
    const pendingEnrollment = buildEnrollment(
      'recipient-pending-id',
      SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    );
    const { service, enrollmentRepository } = setup({
      startedToday: 0,
      pendingEnrollments: [pendingEnrollment],
      sequenceSettings: {
        activeDays: [1],
        windowStart: '09:00',
        windowEnd: '17:00',
        timezone: 'Europe/Helsinki',
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
      },
    });

    await service.tick(workspaceId, recipientNow);

    expect(enrollmentRepository.count).toHaveBeenCalledWith(
      {
        where: {
          sequenceId: sequence.id,
          startedAt: MoreThanOrEqual(new Date('2024-01-01T00:00:00.000Z')),
        },
      },
      expect.any(Object),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: pendingEnrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        startedAt: recipientNow,
        nextActionAt: recipientNow,
      }),
      expect.any(Object),
    );
  });

  it('does not admit recipient-mode enrollments when no sending days are enabled', async () => {
    const pendingEnrollment = buildEnrollment(
      'recipient-pending-id',
      SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    );
    const { service, enrollmentRepository } = setup({
      startedToday: 0,
      pendingEnrollments: [pendingEnrollment],
      sequenceSettings: {
        activeDays: [],
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
      },
    });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).not.toHaveBeenCalled();
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

  it('schedules a recipient-local email while the fixed sequence timezone is closed', async () => {
    const recipientNow = new Date('2024-01-01T16:00:00.000Z');
    const dueEnrollment = buildEnrollment('recipient-local-id');
    const { service, enrollmentRepository, enqueueProcess, personRepository } =
      setup({
        startedToday: 0,
        dueEnrollments: [dueEnrollment],
        sequenceSettings: {
          activeDays: [1],
          windowStart: '09:00',
          windowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
        recipientTimeZones: {
          [dueEnrollment.personId]: 'America/New_York',
        },
      });

    await service.tick(workspaceId, recipientNow);

    expect(personRepository.find).toHaveBeenCalledWith({
      where: { id: expect.anything() },
      select: { id: true, timeZone: true },
    });
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: dueEnrollment.id }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: recipientNow,
      }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });
  });

  it('uses UTC when a recipient-local email has no determined timezone', async () => {
    const recipientNow = new Date('2024-01-01T16:00:00.000Z');
    const dueEnrollment = buildEnrollment('utc-fallback-id');
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 0,
      dueEnrollments: [dueEnrollment],
      sequenceSettings: {
        activeDays: [1],
        windowStart: '09:00',
        windowEnd: '17:00',
        timezone: 'Europe/Helsinki',
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
      },
      recipientTimeZones: { [dueEnrollment.personId]: null },
    });

    await service.tick(workspaceId, recipientNow);

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: dueEnrollment.id }),
      expect.objectContaining({ nextActionAt: recipientNow }),
    );
    expect(enqueueProcess).toHaveBeenCalledTimes(1);
  });

  it('keeps non-email steps behind the fixed sequence window in recipient mode', async () => {
    const recipientNow = new Date('2024-01-01T16:00:00.000Z');
    const dueEnrollment = buildEnrollment('task-id');
    const taskStep = {
      id: 'task-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: { type: SEQUENCE_STEP_TYPES.CREATE_TASK },
    } as SequenceStepWorkspaceEntity;
    const { service, enqueueProcess } = setup({
      startedToday: 0,
      dueEnrollments: [dueEnrollment],
      steps: [taskStep],
      sequenceSettings: {
        activeDays: [1],
        windowStart: '09:00',
        windowEnd: '17:00',
        timezone: 'Europe/Helsinki',
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
      },
      recipientTimeZones: {
        [dueEnrollment.personId]: 'America/New_York',
      },
    });

    await service.tick(workspaceId, recipientNow);

    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('resumes an enrollment whose LinkedIn action already finished', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 2,
      linkedinWaitingEnrollments: [waitingEnrollment],
      linkedinActions: [
        {
          id: 'action-id',
          status: LINKEDIN_ACTION_STATUSES.SKIPPED,
          sequenceEnrollmentId: 'waiting-id',
          sequenceStepId: 'linkedin-step-id',
        } as LinkedinActionWorkspaceEntity,
      ],
    });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'waiting-id' }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: now,
      }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: 'waiting-id',
    });
  });

  it('fails an enrollment whose LinkedIn action disappeared', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository } = setup({
      startedToday: 2,
      linkedinWaitingEnrollments: [waitingEnrollment],
      linkedinActions: [],
    });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'waiting-id' }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: 'LINKEDIN_ACTION_MISSING',
      }),
    );
  });

  it('leaves an enrollment waiting while its LinkedIn action is still scheduled', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository } = setup({
      startedToday: 2,
      linkedinWaitingEnrollments: [waitingEnrollment],
      linkedinActions: [
        {
          id: 'action-id',
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          sequenceEnrollmentId: 'waiting-id',
          sequenceStepId: 'linkedin-step-id',
        } as LinkedinActionWorkspaceEntity,
      ],
    });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'waiting-id' }),
      expect.anything(),
    );
  });

  it('repairs a missed task completion event', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('task-waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
      currentStepId: 'task-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, completeTaskStep } = setup({
      startedToday: 2,
      taskWaitingEnrollments: [waitingEnrollment],
      sequenceTasks: [
        {
          sequenceEnrollmentId: waitingEnrollment.id,
          sequenceStepId: waitingEnrollment.currentStepId,
          status: 'DONE',
        },
      ],
    });

    await service.tick(workspaceId, now);

    expect(completeTaskStep).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: waitingEnrollment.id,
      stepId: waitingEnrollment.currentStepId,
    });
  });

  it('fails a task-waiting enrollment when its current task disappeared', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('task-waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
      currentStepId: 'task-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository } = setup({
      startedToday: 2,
      taskWaitingEnrollments: [waitingEnrollment],
      sequenceTasks: [],
    });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: waitingEnrollment.id,
        currentStepId: waitingEnrollment.currentStepId,
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: 'SEQUENCE_TASK_MISSING',
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
