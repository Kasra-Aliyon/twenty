import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
  type SequenceEnrollmentStatus,
  type SequenceSettings,
  type SequenceStepSettings,
} from 'twenty-shared/types';
import { FindOperator, IsNull, MoreThanOrEqual } from 'typeorm';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { type SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { type SequenceLinkedinInvitationReconcilerService } from 'src/modules/sequence/services/sequence-linkedin-invitation-reconciler.service';
import { type SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { type SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { SequenceSchedulerService } from 'src/modules/sequence/services/sequence-scheduler.service';
import { type SequenceTaskCompletionService } from 'src/modules/sequence/services/sequence-task-completion.service';
import {
  DEFAULT_SEQUENCE_SETTINGS,
  DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_LIMIT,
  SEQUENCE_METRICS_RECONCILE_BATCH_SIZE,
  SEQUENCE_SCHEDULER_BATCH_SIZE,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { TaskWorkspaceEntity } from 'src/modules/task/standard-objects/task.workspace-entity';

describe('SequenceSchedulerService', () => {
  const workspaceId = 'workspace-id';
  const now = new Date('2024-01-01T10:00:00.000Z');
  const expectMillisecondPrecisionDateCondition = (date: Date | string) =>
    expect.objectContaining({
      _type: 'raw',
      _objectLiteralParameters: {
        snapshotUpdatedAt: new Date(date).toISOString(),
      },
    });
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
      updatedAt: '2024-01-01T09:00:00.000Z',
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
    expiredScheduledActions = [],
    taskWaitingEnrollments = [],
    sequenceTasks = [],
    dailyStartLimitEnabled = true,
    senderPool,
    activeSenderAssignments = [],
    sequenceSettings = {},
    steps = [step],
    recipientTimeZones = {},
    staleMetricSequences = [],
    orphanedEmailReservationEnrollments = [],
    emailReservationRecoverySequences,
  }: {
    startedToday: number;
    pendingEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    dueEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    futureScheduledEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    linkedinWaitingEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    linkedinActions?: LinkedinActionWorkspaceEntity[];
    expiredClaimedActions?: LinkedinActionWorkspaceEntity[];
    expiredScheduledActions?: LinkedinActionWorkspaceEntity[];
    taskWaitingEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    sequenceTasks?: Array<{
      id: string;
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
    staleMetricSequences?: SequenceWorkspaceEntity[];
    orphanedEmailReservationEnrollments?: SequenceEnrollmentWorkspaceEntity[];
    emailReservationRecoverySequences?: SequenceWorkspaceEntity[];
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
      find: jest.fn().mockImplementation(async (options) => {
        if (options.withDeleted && options.where.id) {
          return emailReservationRecoverySequences ?? [activeSequence];
        }

        return options.withDeleted ? staleMetricSequences : [activeSequence];
      }),
      findOne: jest.fn().mockResolvedValue(activeSequence),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const enrollmentRepository = {
      count: jest.fn().mockResolvedValue(startedToday),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockImplementation(async (options) => {
        if (Array.isArray(options.where)) {
          return orphanedEmailReservationEnrollments;
        }

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
    const recipients = Object.entries(recipientTimeZones).map(
      ([id, timeZone]) => ({ id, timeZone }),
    );
    const personRepository = {
      find: jest.fn().mockResolvedValue(recipients),
      findOne: jest
        .fn()
        .mockImplementation(async (options) =>
          recipients.find(({ id }) => id === options.where.id),
        ),
    };
    const linkedinActionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockImplementation(async (options) => {
        const where = Array.isArray(options.where)
          ? options.where[0]
          : options.where;

        if (where.sequenceEnrollmentId) {
          return linkedinActions;
        }

        if (where.status === LINKEDIN_ACTION_STATUSES.CLAIMED) {
          return expiredClaimedActions;
        }

        if (where.status === LINKEDIN_ACTION_STATUSES.SCHEDULED) {
          return expiredScheduledActions;
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
    const transactionManager = {};
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<void>) => callback(),
      ),
      getRepository: jest.fn(
        async (_workspaceId: string, entity: object) =>
          repositories.get(entity) ?? {},
      ),
      getGlobalWorkspaceDataSource: jest.fn().mockResolvedValue({
        transaction: jest.fn(async (callback) => callback(transactionManager)),
      }),
    } as unknown as GlobalWorkspaceOrmManager;
    const enqueueProcess = jest.fn();
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;
    const acquireSendLock = jest.fn().mockResolvedValue('mailbox-lock-token');
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
    const reserveLinkedinSlot = jest
      .fn()
      .mockResolvedValue(new Date('2024-01-01T10:05:00.000Z'));
    const sequenceLinkedinThrottleService = {
      reserveSlot: reserveLinkedinSlot,
    } as unknown as SequenceLinkedinThrottleService;
    const reconcileEnrollmentBeforeProviderStart = jest.fn();
    const sequenceLinkedinReplyListener = {
      reconcileEnrollmentBeforeProviderStart,
    } as unknown as SequenceLinkedinReplyListener;
    const recomputeForSequenceInCurrentContext = jest.fn();
    const sequenceMetricsService = {
      recomputeForSequenceInCurrentContext,
    } as unknown as SequenceMetricsService;
    const service = new SequenceSchedulerService(
      globalWorkspaceOrmManager,
      sequenceQueueService,
      sequenceMailboxThrottleService,
      sequenceTaskCompletionService,
      sequenceLinkedinInvitationReconcilerService,
      sequenceLinkedinThrottleService,
      sequenceLinkedinReplyListener,
      sequenceMetricsService,
    );

    return {
      service,
      sequenceRepository,
      enrollmentRepository,
      personRepository,
      linkedinActionRepository,
      taskRepository,
      enqueueProcess,
      acquireSendLock,
      releaseSendLock,
      completeTaskStep,
      reconcileLinkedinInvitations,
      reserveLinkedinSlot,
      reconcileEnrollmentBeforeProviderStart,
      recomputeForSequenceInCurrentContext,
      transactionManager,
    };
  };

  it('continues scheduling when invitation reconciliation fails', async () => {
    const dueEnrollment = buildEnrollment('invitation-repair-failure-due-id');
    const { service, enqueueProcess, reconcileLinkedinInvitations } = setup({
      startedToday: 2,
      dueEnrollments: [dueEnrollment],
    });

    reconcileLinkedinInvitations.mockRejectedValueOnce(
      new Error('invitation sync unavailable'),
    );

    await expect(service.tick(workspaceId, now)).resolves.toBeUndefined();
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });
  });

  it('enqueues a paused sequence email reservation for durable cleanup', async () => {
    const pausedSequence = {
      ...sequence,
      id: 'paused-sequence-id',
      status: SEQUENCE_STATUSES.PAUSED,
    } as SequenceWorkspaceEntity;
    const pausedEnrollment = {
      ...buildEnrollment('paused-email-reservation-id'),
      sequenceId: pausedSequence.id,
      currentStepId: step.id,
      waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      nextActionAt: new Date(now.getTime() + 60_000),
      lastSendAttempt: {
        stepId: step.id,
        attemptedAt: now.toISOString(),
        dailyReservation: {
          mailboxId: 'mailbox-id',
          token: 'paused-reservation-token',
          usageDate: '2024-01-01',
        },
        previousCursor: {
          currentStepId: null,
          currentStepPosition: -1,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: now.toISOString(),
          stopOnReply: true,
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      sequenceRepository,
      enqueueProcess,
    } = setup({
      startedToday: 0,
      orphanedEmailReservationEnrollments: [pausedEnrollment],
      emailReservationRecoverySequences: [pausedSequence],
      sequenceSettings: { activeDays: [] },
    });

    await service.tick(workspaceId, now);

    const recoveryQuery = enrollmentRepository.find.mock.calls
      .map(([options]) => options)
      .find(({ where }) => Array.isArray(where));

    expect(recoveryQuery).toEqual(
      expect.objectContaining({
        take: SEQUENCE_SCHEDULER_BATCH_SIZE,
        order: { updatedAt: 'ASC', id: 'ASC' },
      }),
    );
    expect(sequenceRepository.find).toHaveBeenCalledWith({
      where: { id: expect.any(FindOperator) },
      select: ['id', 'status', 'deletedAt'],
      withDeleted: true,
    });
    expect(enqueueProcess).toHaveBeenCalledTimes(1);
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: pausedEnrollment.id,
    });
  });

  it('does not enqueue an unstarted reservation while its active-sequence lease is live', async () => {
    const liveEnrollment = {
      ...buildEnrollment('live-email-reservation-id'),
      currentStepId: step.id,
      waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      nextActionAt: new Date(now.getTime() + 60_000),
      lastSendAttempt: {
        stepId: step.id,
        attemptedAt: now.toISOString(),
        dailyReservation: {
          mailboxId: 'mailbox-id',
          token: 'live-reservation-token',
          usageDate: '2024-01-01',
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enqueueProcess } = setup({
      startedToday: 0,
      orphanedEmailReservationEnrollments: [liveEnrollment],
      sequenceSettings: { activeDays: [] },
    });

    await service.tick(workspaceId, now);

    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('re-enqueues an active release-pending reservation before its lease expires', async () => {
    const releasePendingEnrollment = {
      ...buildEnrollment('active-release-pending-id'),
      currentStepId: step.id,
      waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      nextActionAt: new Date(now.getTime() + 60_000),
      lastSendAttempt: {
        stepId: step.id,
        attemptedAt: now.toISOString(),
        reservationReleasePendingAt: now.toISOString(),
        dailyReservation: {
          mailboxId: 'mailbox-id',
          token: 'active-release-pending-token',
          usageDate: '2024-01-01',
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enqueueProcess } = setup({
      startedToday: 0,
      orphanedEmailReservationEnrollments: [releasePendingEnrollment],
      sequenceSettings: { activeDays: [] },
    });

    await service.tick(workspaceId, now);

    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: releasePendingEnrollment.id,
    });
  });

  it('enqueues an active orphan immediately when its sequence was archived', async () => {
    const archivedSequence = {
      ...sequence,
      deletedAt: now.toISOString(),
    } as SequenceWorkspaceEntity;
    const archivedEnrollment = {
      ...buildEnrollment('archived-email-reservation-id'),
      currentStepId: step.id,
      waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      nextActionAt: new Date(now.getTime() + 60_000),
      lastSendAttempt: {
        stepId: step.id,
        attemptedAt: now.toISOString(),
        dailyReservation: {
          mailboxId: 'mailbox-id',
          token: 'archived-reservation-token',
          usageDate: '2024-01-01',
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enqueueProcess } = setup({
      startedToday: 0,
      orphanedEmailReservationEnrollments: [archivedEnrollment],
      emailReservationRecoverySequences: [archivedSequence],
      sequenceSettings: { activeDays: [] },
    });

    await service.tick(workspaceId, now);

    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: archivedEnrollment.id,
    });
  });

  it('enqueues a terminal enrollment reservation even when its sequence is active', async () => {
    const repliedEnrollment = {
      ...buildEnrollment(
        'terminal-email-reservation-id',
        SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
      ),
      lastSendAttempt: {
        stepId: step.id,
        attemptedAt: now.toISOString(),
        dailyReservation: {
          mailboxId: 'mailbox-id',
          token: 'terminal-reservation-token',
          usageDate: '2024-01-01',
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enqueueProcess } = setup({
      startedToday: 0,
      orphanedEmailReservationEnrollments: [repliedEnrollment],
      sequenceSettings: { activeDays: [] },
    });

    await service.tick(workspaceId, now);

    expect(enqueueProcess).toHaveBeenCalledTimes(1);
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: repliedEnrollment.id,
    });
  });

  it('does not enqueue provider-started or delivered email reservations for cleanup', async () => {
    const providerStartedEnrollment = {
      ...buildEnrollment(
        'provider-started-terminal-id',
        SEQUENCE_ENROLLMENT_STATUSES.FAILED,
      ),
      lastSendAttempt: {
        stepId: step.id,
        attemptedAt: now.toISOString(),
        providerStartedAt: now.toISOString(),
        dailyReservation: {
          mailboxId: 'mailbox-id',
          token: 'provider-started-token',
          usageDate: '2024-01-01',
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const deliveredEnrollment = {
      ...buildEnrollment(
        'delivered-terminal-id',
        SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
      ),
      lastSendAttempt: {
        stepId: step.id,
        attemptedAt: now.toISOString(),
        providerStartedAt: now.toISOString(),
        dailyReservation: {
          mailboxId: 'mailbox-id',
          token: 'delivered-token',
          usageDate: '2024-01-01',
        },
        deliveredEmail: {
          stepPosition: step.position,
          metadata: {
            headerMessageId: 'header-message-id',
            threadExternalId: 'thread-external-id',
            sentAt: now.toISOString(),
          },
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enqueueProcess } = setup({
      startedToday: 0,
      orphanedEmailReservationEnrollments: [
        providerStartedEnrollment,
        deliveredEnrollment,
      ],
      sequenceSettings: { activeDays: [] },
    });

    await service.tick(workspaceId, now);

    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('re-enqueues a provider marker whose reservation release is already pending', async () => {
    const releasePendingEnrollment = {
      ...buildEnrollment(
        'release-pending-terminal-id',
        SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
      ),
      lastSendAttempt: {
        stepId: step.id,
        attemptedAt: now.toISOString(),
        providerStartedAt: now.toISOString(),
        reservationReleasePendingAt: now.toISOString(),
        dailyReservation: {
          mailboxId: 'mailbox-id',
          token: 'release-pending-token',
          usageDate: '2024-01-01',
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enqueueProcess } = setup({
      startedToday: 0,
      orphanedEmailReservationEnrollments: [releasePendingEnrollment],
      sequenceSettings: { activeDays: [] },
    });

    await service.tick(workspaceId, now);

    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: releasePendingEnrollment.id,
    });
  });

  it('includes expired Apollo waits in the durable due queue', async () => {
    const dueEnrollment = {
      ...buildEnrollment('apollo-timeout-enrollment-id'),
      currentStepId: 'apollo-step-id',
      currentStepPosition: 0,
      waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 0,
      dueEnrollments: [dueEnrollment],
    });

    await service.tick(workspaceId, now);

    const dueFindOptions = enrollmentRepository.find.mock.calls
      .map(([options]) => options)
      .find((options) => options.where.nextActionAt);

    expect(
      (dueFindOptions.where.waitingOn as FindOperator<string[]>).value,
    ).toContain(SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT);
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });
  });

  it('does not retry a direct message whose claimed browser outcome is unknown', async () => {
    const expiredMessage = {
      id: 'message-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      executedAt: new Date('2024-01-01T09:01:00.000Z'),
      attemptCount: 0,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: null,
      sequenceStepId: null,
    } as LinkedinActionWorkspaceEntity;
    const { service, linkedinActionRepository, transactionManager } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredMessage],
    });

    linkedinActionRepository.findOne.mockResolvedValue(expiredMessage);

    await service.tick(workspaceId, now);

    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expiredMessage.id,
        executedAt: expect.anything(),
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        executedAt: now,
        errorMessage: 'LINKEDIN_ACTION_OUTCOME_UNKNOWN',
      }),
      transactionManager,
    );
  });

  it('requeues an unstarted direct message under the default direct policy', async () => {
    const expiredMessage = {
      id: 'unstarted-message-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      executedAt: null,
      attemptCount: 0,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: null,
      sequenceStepId: null,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      linkedinActionRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredMessage],
    });

    linkedinActionRepository.findOne.mockResolvedValue(expiredMessage);

    await service.tick(workspaceId, now);

    expect(reserveLinkedinSlot).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: expiredMessage.ownerWorkspaceMemberId,
      settings: DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
      now,
      transactionManager,
      excludedActionId: expiredMessage.id,
    });
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expiredMessage.id,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        executedAt: expect.anything(),
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        claimedAt: null,
        claimedBy: null,
        scheduledAt: new Date('2024-01-01T10:05:00.000Z'),
        executedAt: null,
        errorMessage: null,
      }),
      transactionManager,
    );
  });

  it('requeues an expired direct connection claim under the default direct policy', async () => {
    const expiredRequest = {
      id: 'request-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      executedAt: new Date('2024-01-01T09:01:00.000Z'),
      attemptCount: 2,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: null,
      sequenceStepId: null,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      linkedinActionRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredRequest],
    });

    linkedinActionRepository.findOne.mockResolvedValue(expiredRequest);

    await service.tick(workspaceId, now);

    expect(reserveLinkedinSlot).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: expiredRequest.ownerWorkspaceMemberId,
      settings: DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
      now,
      transactionManager,
      excludedActionId: expiredRequest.id,
    });
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expiredRequest.id,
        executedAt: expect.anything(),
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        claimedAt: null,
        claimedBy: null,
        attemptCount: 3,
        scheduledAt: new Date('2024-01-01T10:05:00.000Z'),
        executedAt: null,
        errorMessage: null,
      }),
      transactionManager,
    );
  });

  it('fails an unstarted direct claim after the shared retry limit', async () => {
    const expiredRequest = {
      id: 'exhausted-direct-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      executedAt: null,
      attemptCount: SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_LIMIT,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: null,
      sequenceStepId: null,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      linkedinActionRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredRequest],
    });

    linkedinActionRepository.findOne.mockResolvedValue(expiredRequest);

    await service.tick(workspaceId, now);

    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expiredRequest.id }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        executedAt: null,
        errorMessage:
          SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
      }),
      transactionManager,
    );
  });

  it('marks an expired never-claimed action as unstarted', async () => {
    const expiredScheduledAction = {
      id: 'expired-never-claimed-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      scheduledAt: new Date('2023-12-20T09:00:00.000Z'),
      sequenceEnrollmentId: null,
      sequenceStepId: null,
    } as LinkedinActionWorkspaceEntity;
    const { service, linkedinActionRepository } = setup({
      startedToday: 0,
      expiredScheduledActions: [expiredScheduledAction],
    });

    await service.tick(workspaceId, now);

    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expiredScheduledAction.id,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      }),
      {
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        executedAt: null,
        errorMessage:
          SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
      },
    );
  });

  it('does not sweep a claim whose provider-start lease was renewed after candidate selection', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('started-waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const startedRequest = {
      id: 'fresh-provider-start-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      executedAt: new Date('2024-01-01T09:59:00.000Z'),
      attemptCount: 0,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: waitingEnrollment.id,
      sequenceStepId: waitingEnrollment.currentStepId,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      transactionManager,
    } = setup({
      startedToday: 0,
      // Simulate the candidate read winning just before start() commits. The
      // locked recheck must observe the fresh executedAt and reject the sweep.
      expiredClaimedActions: [startedRequest],
    });

    enrollmentRepository.find.mockResolvedValueOnce([
      { id: waitingEnrollment.id, sequenceId: sequence.id },
    ]);
    enrollmentRepository.findOne.mockResolvedValue(waitingEnrollment);
    linkedinActionRepository.findOne.mockResolvedValue(null);

    await service.tick(workspaceId, now);

    expect(linkedinActionRepository.find).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: [
          expect.objectContaining({ executedAt: expect.anything() }),
          expect.objectContaining({ executedAt: expect.anything() }),
        ],
      }),
    );
    expect(linkedinActionRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          expect.objectContaining({ executedAt: expect.anything() }),
          expect.objectContaining({ executedAt: expect.anything() }),
        ],
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(linkedinActionRepository.update).not.toHaveBeenCalled();
  });

  it.each([SEQUENCE_STATUSES.PAUSED, SEQUENCE_STATUSES.DRAFT])(
    'keeps an expired idempotent sequence claim owned while its sequence is %s',
    async (sequenceStatus) => {
      const waitingEnrollment = {
        ...buildEnrollment('waiting-id'),
        waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        currentStepId: 'linkedin-step-id',
        nextActionAt: null,
      } as SequenceEnrollmentWorkspaceEntity;
      const expiredRequest = {
        id: 'request-action-id',
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
        claimedAt: new Date('2024-01-01T09:00:00.000Z'),
        attemptCount: 2,
        ownerWorkspaceMemberId: 'owner-workspace-member-id',
        sequenceEnrollmentId: waitingEnrollment.id,
        sequenceStepId: waitingEnrollment.currentStepId,
      } as LinkedinActionWorkspaceEntity;
      const {
        service,
        enrollmentRepository,
        linkedinActionRepository,
        sequenceRepository,
        transactionManager,
      } = setup({
        startedToday: 0,
        expiredClaimedActions: [expiredRequest],
      });

      enrollmentRepository.find.mockResolvedValueOnce([
        { id: waitingEnrollment.id, sequenceId: sequence.id },
      ]);
      enrollmentRepository.findOne.mockResolvedValue(waitingEnrollment);
      sequenceRepository.findOne.mockResolvedValue({
        ...sequence,
        status: sequenceStatus,
      });
      linkedinActionRepository.findOne.mockResolvedValue(expiredRequest);

      await service.tick(workspaceId, now);

      expect(sequenceRepository.findOne).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
        transactionManager,
      );
      expect(enrollmentRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
        transactionManager,
      );
      expect(linkedinActionRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
        transactionManager,
      );
      expect(linkedinActionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expiredRequest.id,
          status: LINKEDIN_ACTION_STATUSES.CLAIMED,
          claimedAt: expiredRequest.claimedAt,
        }),
        { updatedAt: now.toISOString() },
        transactionManager,
      );
    },
  );

  it('rotates a full page of paused claims so a later unknown outcome is swept', async () => {
    const pausedActions = Array.from(
      { length: SEQUENCE_SCHEDULER_BATCH_SIZE },
      (_, index) =>
        ({
          id: `paused-claim-${index}`,
          type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
          status: LINKEDIN_ACTION_STATUSES.CLAIMED,
          claimedAt: new Date('2024-01-01T09:00:00.000Z'),
          attemptCount: 0,
          ownerWorkspaceMemberId: 'owner-workspace-member-id',
          sequenceEnrollmentId: `paused-enrollment-${index}`,
          sequenceStepId: `paused-step-${index}`,
        }) as LinkedinActionWorkspaceEntity,
    );
    const unknownOutcome = {
      id: 'later-unknown-outcome',
      type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      executedAt: new Date('2024-01-01T09:01:00.000Z'),
      attemptCount: 0,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: null,
      sequenceStepId: null,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      sequenceRepository,
      transactionManager,
    } = setup({ startedToday: 0 });
    const defaultEnrollmentFind =
      enrollmentRepository.find.getMockImplementation();
    const defaultActionFind =
      linkedinActionRepository.find.getMockImplementation();
    let claimPage = 0;

    enrollmentRepository.find.mockImplementation(async (options) => {
      if (options.withDeleted && options.where.id) {
        return pausedActions.map((action) => ({
          id: action.sequenceEnrollmentId,
          sequenceId: sequence.id,
        }));
      }

      return defaultEnrollmentFind?.(options) ?? [];
    });
    enrollmentRepository.findOne.mockImplementation(async (options) => {
      const enrollmentId = options.where.id;
      const action = pausedActions.find(
        ({ sequenceEnrollmentId }) => sequenceEnrollmentId === enrollmentId,
      );

      return action
        ? ({
            id: enrollmentId,
            sequenceId: sequence.id,
            status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
            currentStepId: action.sequenceStepId,
          } as SequenceEnrollmentWorkspaceEntity)
        : null;
    });
    sequenceRepository.findOne.mockResolvedValue({
      ...sequence,
      status: SEQUENCE_STATUSES.PAUSED,
    });
    linkedinActionRepository.find.mockImplementation(async (options) => {
      if (Array.isArray(options.where)) {
        return claimPage++ === 0 ? pausedActions : [unknownOutcome];
      }

      return defaultActionFind?.(options) ?? [];
    });
    linkedinActionRepository.findOne.mockImplementation(async (options) => {
      const actionId = Array.isArray(options.where)
        ? options.where[0].id
        : options.where.id;

      return (
        pausedActions.find(({ id }) => id === actionId) ??
        (unknownOutcome.id === actionId ? unknownOutcome : null)
      );
    });

    await service.tick(workspaceId, now);

    const rotationCalls = linkedinActionRepository.update.mock.calls.filter(
      ([, data]) => data.updatedAt === now.toISOString(),
    );

    expect(rotationCalls).toHaveLength(SEQUENCE_SCHEDULER_BATCH_SIZE);
    expect(linkedinActionRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { updatedAt: 'ASC', id: 'ASC' },
        take: SEQUENCE_SCHEDULER_BATCH_SIZE,
      }),
    );

    const secondTickNow = new Date(now.getTime() + 1);

    await service.tick(workspaceId, secondTickNow);

    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: unknownOutcome.id }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        errorMessage: 'LINKEDIN_ACTION_OUTCOME_UNKNOWN',
      }),
      transactionManager,
    );
  });

  it('requeues an expired sequence claim with the fixed sequence window', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const expiredRequest = {
      id: 'request-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      attemptCount: 2,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: waitingEnrollment.id,
      sequenceStepId: waitingEnrollment.currentStepId,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      personRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredRequest],
      sequenceSettings: {
        activeDays: [1],
        windowStart: '09:00',
        windowEnd: '17:00',
        timezone: 'Europe/Helsinki',
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
      },
      recipientTimeZones: {
        [waitingEnrollment.personId]: 'America/Los_Angeles',
      },
    });

    enrollmentRepository.find.mockResolvedValueOnce([
      { id: waitingEnrollment.id, sequenceId: sequence.id },
    ]);
    enrollmentRepository.findOne.mockResolvedValue(waitingEnrollment);
    linkedinActionRepository.findOne.mockResolvedValue(expiredRequest);

    await service.tick(workspaceId, now);

    expect(reserveLinkedinSlot).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: expiredRequest.ownerWorkspaceMemberId,
      settings: expect.objectContaining({
        linkedinDailyActions: DEFAULT_SEQUENCE_SETTINGS.linkedinDailyActions,
        timezone: 'Europe/Helsinki',
      }),
      now,
      transactionManager,
      excludedActionId: expiredRequest.id,
    });
    expect(personRepository.findOne).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expiredRequest.id,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        claimedAt: null,
        claimedBy: null,
        attemptCount: 3,
        scheduledAt: new Date('2024-01-01T10:05:00.000Z'),
      }),
      transactionManager,
    );
  });

  it('fails an active sequence claim after the shared retry limit', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('exhausted-waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const expiredRequest = {
      id: 'exhausted-sequence-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      executedAt: null,
      attemptCount: SEQUENCE_LINKEDIN_ACTION_UNSTARTED_RETRY_LIMIT,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: waitingEnrollment.id,
      sequenceStepId: waitingEnrollment.currentStepId,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredRequest],
    });

    enrollmentRepository.find.mockResolvedValueOnce([
      { id: waitingEnrollment.id, sequenceId: sequence.id },
    ]);
    enrollmentRepository.findOne.mockResolvedValue(waitingEnrollment);
    linkedinActionRepository.findOne.mockResolvedValue(expiredRequest);

    await service.tick(workspaceId, now);

    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expiredRequest.id }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        executedAt: null,
        errorMessage:
          SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
      }),
      transactionManager,
    );
  });

  it('requeues an expired sequence message when provider start never committed', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('unstarted-message-waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-message-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const expiredMessage = {
      id: 'unstarted-sequence-message-id',
      type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      executedAt: null,
      attemptCount: 0,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: waitingEnrollment.id,
      sequenceStepId: waitingEnrollment.currentStepId,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredMessage],
    });

    enrollmentRepository.find.mockResolvedValueOnce([
      { id: waitingEnrollment.id, sequenceId: sequence.id },
    ]);
    enrollmentRepository.findOne.mockResolvedValue(waitingEnrollment);
    linkedinActionRepository.findOne.mockResolvedValue(expiredMessage);

    await service.tick(workspaceId, now);

    expect(reserveLinkedinSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        ownerWorkspaceMemberId: expiredMessage.ownerWorkspaceMemberId,
        excludedActionId: expiredMessage.id,
      }),
    );
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expiredMessage.id,
        executedAt: expect.anything(),
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        claimedAt: null,
        claimedBy: null,
        attemptCount: 1,
        scheduledAt: new Date('2024-01-01T10:05:00.000Z'),
        executedAt: null,
      }),
      transactionManager,
    );
  });

  it('fails without retrying an expired runner claim after its enrollment replied', async () => {
    const repliedEnrollment = {
      ...buildEnrollment(
        'replied-enrollment-id',
        SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
      ),
      currentStepId: 'linkedin-step-id',
      waitingOn: null,
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const expiredRequest = {
      id: 'lost-runner-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      attemptCount: 0,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: repliedEnrollment.id,
      sequenceStepId: repliedEnrollment.currentStepId,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredRequest],
    });

    enrollmentRepository.find.mockResolvedValueOnce([
      { id: repliedEnrollment.id, sequenceId: sequence.id },
    ]);
    enrollmentRepository.findOne.mockResolvedValue(repliedEnrollment);
    linkedinActionRepository.findOne.mockResolvedValue(expiredRequest);

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        select: ['id', 'status', 'waitingOn', 'currentStepId'],
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expiredRequest.id,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      }),
      {
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        claimedAt: null,
        claimedBy: null,
        attemptCount: 1,
        executedAt: null,
        errorMessage: 'LINKEDIN_ACTION_UNSTARTED_EXPIRED',
      },
      transactionManager,
    );
  });

  it('retires a preserved archive claim using soft-deleted context', async () => {
    const archivedAt = new Date('2024-01-01T09:15:00.000Z');
    const archivedEnrollment = {
      ...buildEnrollment(
        'archived-enrollment-id',
        SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
      ),
      currentStepId: 'linkedin-step-id',
      waitingOn: null,
      nextActionAt: null,
      deletedAt: archivedAt.toISOString(),
    } as SequenceEnrollmentWorkspaceEntity;
    const expiredRequest = {
      id: 'archived-runner-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      attemptCount: 0,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: archivedEnrollment.id,
      sequenceStepId: archivedEnrollment.currentStepId,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      sequenceRepository,
      enrollmentRepository,
      linkedinActionRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredRequest],
    });

    enrollmentRepository.find.mockResolvedValueOnce([
      { id: archivedEnrollment.id, sequenceId: sequence.id },
    ]);
    enrollmentRepository.findOne.mockResolvedValue(archivedEnrollment);
    sequenceRepository.findOne.mockResolvedValue({
      ...sequence,
      status: SEQUENCE_STATUSES.PAUSED,
      deletedAt: archivedAt.toISOString(),
    });
    linkedinActionRepository.findOne.mockResolvedValue(expiredRequest);

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.find).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ withDeleted: true }),
    );
    expect(sequenceRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(enrollmentRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expiredRequest.id,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        attemptCount: 1,
        executedAt: null,
        errorMessage: 'LINKEDIN_ACTION_UNSTARTED_EXPIRED',
      }),
      transactionManager,
    );
  });

  it('fails an archived lost-report message as outcome unknown', async () => {
    const archivedAt = new Date('2024-01-01T09:15:00.000Z');
    const archivedEnrollment = {
      ...buildEnrollment(
        'archived-message-enrollment-id',
        SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
      ),
      currentStepId: 'linkedin-message-step-id',
      waitingOn: null,
      nextActionAt: null,
      deletedAt: archivedAt.toISOString(),
    } as SequenceEnrollmentWorkspaceEntity;
    const expiredMessage = {
      id: 'archived-lost-message-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T08:55:00.000Z'),
      claimedAt: new Date('2024-01-01T09:00:00.000Z'),
      executedAt: new Date('2024-01-01T09:01:00.000Z'),
      attemptCount: 0,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: archivedEnrollment.id,
      sequenceStepId: archivedEnrollment.currentStepId,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      sequenceRepository,
      enrollmentRepository,
      linkedinActionRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredMessage],
    });

    enrollmentRepository.find.mockResolvedValueOnce([
      { id: archivedEnrollment.id, sequenceId: sequence.id },
    ]);
    enrollmentRepository.findOne.mockResolvedValue(archivedEnrollment);
    sequenceRepository.findOne.mockResolvedValue({
      ...sequence,
      status: SEQUENCE_STATUSES.PAUSED,
      deletedAt: archivedAt.toISOString(),
    });
    linkedinActionRepository.findOne.mockResolvedValue(expiredMessage);

    await service.tick(workspaceId, now);

    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expiredMessage.id,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      }),
      {
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        claimedAt: null,
        claimedBy: null,
        attemptCount: 1,
        executedAt: now,
        errorMessage: 'LINKEDIN_ACTION_OUTCOME_UNKNOWN',
      },
      transactionManager,
    );
  });

  it('persists a freshly capped slot when a stale claim crosses UTC midnight', async () => {
    const requeueNow = new Date('2024-01-02T00:01:00.000Z');
    const rolledSlot = new Date('2024-01-03T00:05:00.000Z');
    const waitingEnrollment = {
      ...buildEnrollment('midnight-waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const expiredRequest = {
      id: 'midnight-request-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: new Date('2024-01-01T23:45:00.000Z'),
      claimedAt: new Date('2024-01-01T23:50:00.000Z'),
      attemptCount: 0,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      sequenceEnrollmentId: waitingEnrollment.id,
      sequenceStepId: waitingEnrollment.currentStepId,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      reserveLinkedinSlot,
      transactionManager,
    } = setup({
      startedToday: 0,
      expiredClaimedActions: [expiredRequest],
    });

    enrollmentRepository.find.mockResolvedValueOnce([
      { id: waitingEnrollment.id, sequenceId: sequence.id },
    ]);
    enrollmentRepository.findOne.mockResolvedValue(waitingEnrollment);
    linkedinActionRepository.findOne.mockResolvedValue(expiredRequest);
    reserveLinkedinSlot.mockResolvedValue(rolledSlot);

    await service.tick(workspaceId, requeueNow);

    expect(reserveLinkedinSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        ownerWorkspaceMemberId: expiredRequest.ownerWorkspaceMemberId,
        now: requeueNow,
        transactionManager,
        excludedActionId: expiredRequest.id,
      }),
    );
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expiredRequest.id }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: rolledSlot,
      }),
      transactionManager,
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

    expect(pendingFindCall?.[0]).toEqual(
      expect.objectContaining({ take: SEQUENCE_SCHEDULER_BATCH_SIZE }),
    );
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

  it('prioritizes staged pending enrollments before fresh enrollments', async () => {
    const stagedEnrollment = {
      ...buildEnrollment(
        'staged-pending-id',
        SEQUENCE_ENROLLMENT_STATUSES.PENDING,
      ),
      currentStepPosition: 2.5,
    } as SequenceEnrollmentWorkspaceEntity;
    const freshEnrollment = buildEnrollment(
      'fresh-pending-id',
      SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    );
    const { service, enrollmentRepository } = setup({
      startedToday: 0,
      pendingEnrollments: [stagedEnrollment, freshEnrollment],
    });

    await service.tick(workspaceId, now);

    const pendingFindCall = enrollmentRepository.find.mock.calls.find(
      ([options]) =>
        options.where.status === SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    );

    expect(pendingFindCall?.[0]).toEqual(
      expect.objectContaining({
        order: {
          currentStepPosition: 'DESC',
          createdAt: 'ASC',
          id: 'ASC',
        },
      }),
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

  it('admits in the fixed sequence window and counts the UTC quota day', async () => {
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
      recipientTimeZones: {
        [pendingEnrollment.personId]: 'America/Los_Angeles',
      },
    });

    await service.tick(workspaceId, now);

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
        startedAt: now,
        nextActionAt: now,
      }),
      expect.any(Object),
    );
  });

  it('does not admit outside the fixed sequence window when the recipient window is open', async () => {
    const recipientNow = new Date('2024-01-01T22:30:00.000Z');
    const pendingEnrollment = buildEnrollment(
      'closed-recipient-pending-id',
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
      recipientTimeZones: {
        [pendingEnrollment.personId]: 'America/Los_Angeles',
      },
    });

    await service.tick(workspaceId, recipientNow);

    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: pendingEnrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      }),
      expect.any(Object),
    );
  });

  it('keeps staged-first admission independent of recipient timezones', async () => {
    const stagedEnrollment = {
      ...buildEnrollment(
        'staged-recipient-id',
        SEQUENCE_ENROLLMENT_STATUSES.PENDING,
      ),
      currentStepPosition: 2.5,
    } as SequenceEnrollmentWorkspaceEntity;
    const freshEnrollment = buildEnrollment(
      'fresh-recipient-id',
      SEQUENCE_ENROLLMENT_STATUSES.PENDING,
    );
    const { service, enrollmentRepository } = setup({
      startedToday: 1,
      pendingEnrollments: [stagedEnrollment, freshEnrollment],
      sequenceSettings: {
        activeDays: [1],
        windowStart: '09:00',
        windowEnd: '17:00',
        timezone: 'Europe/Helsinki',
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
      },
      recipientTimeZones: {
        [stagedEnrollment.personId]: 'America/Los_Angeles',
        [freshEnrollment.personId]: 'Europe/London',
      },
    });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: stagedEnrollment.id }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        startedAt: now,
      }),
      expect.any(Object),
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: freshEnrollment.id }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
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

  it('queues the current paused LinkedIn retry instead of scheduling the following email', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const emailStep = {
      ...step,
      id: 'email-step-id',
      position: 1,
    } as SequenceStepWorkspaceEntity;
    const dueEnrollment = {
      ...buildEnrollment('paused-retry-id'),
      currentStepId: connectionStep.id,
      currentStepPosition: connectionStep.position,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 1,
      dueEnrollments: [dueEnrollment],
      steps: [connectionStep, emailStep],
      linkedinActions: [
        {
          id: 'paused-action-id',
          sequenceEnrollmentId: dueEnrollment.id,
          sequenceStepId: connectionStep.id,
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
          createdAt: new Date('2024-01-01T09:00:00.000Z'),
        } as unknown as LinkedinActionWorkspaceEntity,
      ],
    });

    await service.tick(workspaceId, now);

    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });
    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: dueEnrollment.id }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
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

  it('schedules an email in its dedicated window while the task window is closed', async () => {
    const emailWindowNow = new Date('2024-01-01T16:00:00.000Z');
    const dueEnrollment = buildEnrollment('split-window-email-id');
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 0,
      dueEnrollments: [dueEnrollment],
      sequenceSettings: {
        activeDays: [1],
        windowStart: '09:00',
        windowEnd: '10:00',
        emailWindowStart: '17:00',
        emailWindowEnd: '19:00',
        timezone: 'Europe/Helsinki',
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.SEQUENCE,
      },
    });

    await service.tick(workspaceId, emailWindowNow);

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: dueEnrollment.id }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: emailWindowNow,
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

  it('defers a Los Angeles email while the fixed Helsinki window is open', async () => {
    const dueEnrollment = buildEnrollment('los-angeles-email-id');
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
          [dueEnrollment.personId]: 'America/Los_Angeles',
        },
      });

    await service.tick(workspaceId, now);

    expect(personRepository.find).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: dueEnrollment.id }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date('2024-01-01T17:00:00.000Z'),
      }),
    );
    expect(enqueueProcess).not.toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });
  });

  it('defers then queues a manual email in the recipient window', async () => {
    const dueEnrollment = buildEnrollment('manual-los-angeles-email-id');
    const manualEmailStep = {
      ...step,
      id: 'manual-los-angeles-email-step-id',
      settings: {
        ...step.settings,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, enqueueProcess, personRepository } =
      setup({
        startedToday: 0,
        dueEnrollments: [dueEnrollment],
        steps: [manualEmailStep],
        sequenceSettings: {
          activeDays: [1],
          windowStart: '09:00',
          windowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
        recipientTimeZones: {
          [dueEnrollment.personId]: 'America/Los_Angeles',
        },
      });

    await service.tick(workspaceId, now);

    expect(personRepository.find).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: dueEnrollment.id }),
      expect.objectContaining({
        nextActionAt: new Date('2024-01-01T17:00:00.000Z'),
      }),
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: dueEnrollment.id }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      }),
    );
    expect(enqueueProcess).not.toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });

    await service.tick(workspaceId, new Date('2024-01-01T17:00:00.000Z'));

    expect(personRepository.find).toHaveBeenCalledTimes(2);
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });
  });

  it('defers non-email work to the fixed sequence window', async () => {
    const recipientNow = new Date('2024-01-01T16:00:00.000Z');
    const dueEnrollment = buildEnrollment('task-id');
    const taskStep = {
      id: 'task-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: { type: SEQUENCE_STEP_TYPES.CREATE_TASK },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 0,
      dueEnrollments: [dueEnrollment],
      steps: [taskStep],
      sequenceSettings: {
        activeDays: [1, 2],
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

    expect(enqueueProcess).not.toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: dueEnrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      }),
      { nextActionAt: new Date('2024-01-02T07:00:00.000Z') },
    );
  });

  it.each([
    {
      label: 'condition',
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.HAS_EMAIL_ADDRESS,
      } as SequenceStepSettings,
    },
    {
      label: 'LinkedIn',
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      } as SequenceStepSettings,
    },
  ])(
    'queues $label work in the fixed sequence window',
    async ({ label, settings: stepSettings }) => {
      const dueEnrollment = buildEnrollment(`fixed-window-${label}-id`);
      const dueStep = {
        id: `fixed-window-${label}-step-id`,
        sequenceId: sequence.id,
        position: 0,
        type: stepSettings.type,
        settings: stepSettings,
      } as SequenceStepWorkspaceEntity;
      const {
        service,
        enrollmentRepository,
        enqueueProcess,
        personRepository,
      } = setup({
        startedToday: 0,
        dueEnrollments: [dueEnrollment],
        steps: [dueStep],
        sequenceSettings: {
          activeDays: [1],
          windowStart: '09:00',
          windowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
        recipientTimeZones: {
          [dueEnrollment.personId]: 'America/Los_Angeles',
        },
      });

      await service.tick(workspaceId, now);

      expect(enqueueProcess).toHaveBeenCalledWith({
        workspaceId,
        enrollmentId: dueEnrollment.id,
      });
      expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: dueEnrollment.id }),
        { nextActionAt: expect.any(Date) },
      );
      expect(personRepository.find).not.toHaveBeenCalled();
    },
  );

  it('defers a full page of closed fixed-window work so later eligible email can run', async () => {
    const recipientNow = new Date('2024-01-01T16:00:00.000Z');
    const taskStep = {
      id: 'fixed-window-task-step',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: { type: SEQUENCE_STEP_TYPES.CREATE_TASK },
    } as SequenceStepWorkspaceEntity;
    const emailStep = {
      ...step,
      id: 'recipient-window-email-step',
      position: 1,
    } as SequenceStepWorkspaceEntity;
    const blockedEnrollments = Array.from(
      { length: SEQUENCE_SCHEDULER_BATCH_SIZE },
      (_, index) => buildEnrollment(`fixed-window-blocked-${index}`),
    );
    const eligibleEmailEnrollment = {
      ...buildEnrollment('recipient-window-eligible-email'),
      currentStepId: taskStep.id,
      currentStepPosition: taskStep.position,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 2,
      steps: [taskStep, emailStep],
      sequenceSettings: {
        activeDays: [1],
        windowStart: '09:00',
        windowEnd: '17:00',
        timezone: 'Europe/Helsinki',
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
      },
      recipientTimeZones: {
        ...Object.fromEntries(
          blockedEnrollments.map((enrollment) => [
            enrollment.personId,
            'Europe/Helsinki',
          ]),
        ),
        [eligibleEmailEnrollment.personId]: 'America/New_York',
      },
    });
    const defaultFind = enrollmentRepository.find.getMockImplementation();
    let duePage = 0;

    enrollmentRepository.find.mockImplementation(async (options) => {
      if (options.where.nextActionAt) {
        return duePage++ === 0 ? blockedEnrollments : [eligibleEmailEnrollment];
      }

      return defaultFind?.(options) ?? [];
    });

    await service.tick(workspaceId, recipientNow);

    const deferredIds = new Set(
      enrollmentRepository.update.mock.calls
        .filter(([, data]) => data.nextActionAt instanceof Date)
        .map(([criteria]) => criteria.id),
    );

    expect(deferredIds).toEqual(
      new Set(blockedEnrollments.map(({ id }) => id)),
    );
    expect(enqueueProcess).not.toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: eligibleEmailEnrollment.id,
    });

    await service.tick(workspaceId, new Date(recipientNow.getTime() + 1));

    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: eligibleEmailEnrollment.id,
    });
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
      expect.objectContaining({
        id: 'waiting-id',
        currentStepId: waitingEnrollment.currentStepId,
        updatedAt: expectMillisecondPrecisionDateCondition(
          waitingEnrollment.updatedAt,
        ),
      }),
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

  it('reconciles durable LinkedIn replies before repairing a missed completion event', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('reply-waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-message-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const completedAction = {
      id: 'completed-message-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      sequenceEnrollmentId: waitingEnrollment.id,
      sequenceStepId: waitingEnrollment.currentStepId,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      personId: waitingEnrollment.personId,
      executedAt: new Date('2024-01-01T09:55:00.000Z'),
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      enqueueProcess,
      reconcileEnrollmentBeforeProviderStart,
    } = setup({
      startedToday: 2,
      linkedinWaitingEnrollments: [waitingEnrollment],
      linkedinActions: [completedAction],
    });

    // Durable reconciliation won the ACTIVE -> REPLIED CAS, so the scheduler
    // repair must not enqueue the next sequence step.
    enrollmentRepository.update.mockResolvedValueOnce({ affected: 0 });

    await service.tick(workspaceId, now);

    expect(reconcileEnrollmentBeforeProviderStart).toHaveBeenCalledWith({
      sequenceEnrollmentId: waitingEnrollment.id,
      workspaceId,
    });
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: waitingEnrollment.id,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        currentStepId: waitingEnrollment.currentStepId,
        updatedAt: expectMillisecondPrecisionDateCondition(
          waitingEnrollment.updatedAt,
        ),
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
    );
    expect(enqueueProcess).not.toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: waitingEnrollment.id,
    });
  });

  it('rotates a LinkedIn waiter and continues scheduling when reply reconciliation fails', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('reply-reconciliation-error-waiting-id'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'linkedin-message-step-id',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const dueEnrollment = buildEnrollment('reply-reconciliation-error-due-id');
    const completedAction = {
      id: 'reply-reconciliation-error-action-id',
      type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      sequenceEnrollmentId: waitingEnrollment.id,
      sequenceStepId: waitingEnrollment.currentStepId,
      ownerWorkspaceMemberId: 'owner-workspace-member-id',
      personId: waitingEnrollment.personId,
      executedAt: new Date('2024-01-01T09:55:00.000Z'),
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      enqueueProcess,
      reconcileEnrollmentBeforeProviderStart,
    } = setup({
      startedToday: 2,
      dueEnrollments: [dueEnrollment],
      linkedinWaitingEnrollments: [waitingEnrollment],
      linkedinActions: [completedAction],
    });

    reconcileEnrollmentBeforeProviderStart.mockRejectedValueOnce(
      new Error('reply reconciliation unavailable'),
    );

    await expect(service.tick(workspaceId, now)).resolves.toBeUndefined();

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: waitingEnrollment.id,
        currentStepId: waitingEnrollment.currentStepId,
        updatedAt: expectMillisecondPrecisionDateCondition(
          waitingEnrollment.updatedAt,
        ),
      }),
      { updatedAt: now.toISOString() },
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: waitingEnrollment.id }),
      expect.objectContaining({ waitingOn: SEQUENCE_WAITING_ON.DELAY }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });
  });

  it('periodically repairs counters when an enrollment event was lost', async () => {
    const staleSequence = {
      id: 'stale-sequence-id',
      updatedAt: '2024-01-01T09:00:00.000Z',
    } as SequenceWorkspaceEntity;
    const {
      service,
      sequenceRepository,
      recomputeForSequenceInCurrentContext,
    } = setup({
      startedToday: 2,
      staleMetricSequences: [staleSequence],
    });

    await service.tick(workspaceId, now);

    expect(sequenceRepository.find).toHaveBeenCalledWith({
      where: { updatedAt: expect.anything() },
      select: ['id'],
      withDeleted: true,
      order: { updatedAt: 'ASC', id: 'ASC' },
      take: 20,
    });
    expect(recomputeForSequenceInCurrentContext).toHaveBeenCalledWith({
      workspaceId,
      sequenceId: staleSequence.id,
    });
  });

  it('continues scheduling when periodic counter repair fails', async () => {
    const dueEnrollment = buildEnrollment('metrics-failure-due-id');
    const staleSequence = {
      id: 'poisoned-metrics-sequence-id',
      updatedAt: '2024-01-01T09:00:00.000Z',
    } as SequenceWorkspaceEntity;
    const {
      service,
      sequenceRepository,
      enqueueProcess,
      recomputeForSequenceInCurrentContext,
    } = setup({
      startedToday: 2,
      dueEnrollments: [dueEnrollment],
      staleMetricSequences: [staleSequence],
    });

    recomputeForSequenceInCurrentContext.mockRejectedValueOnce(
      new Error('metrics lock timeout'),
    );

    await expect(service.tick(workspaceId, now)).resolves.toBeUndefined();
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: dueEnrollment.id,
    });
    expect(sequenceRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: staleSequence.id,
        updatedAt: expect.anything(),
      }),
      { updatedAt: now.toISOString() },
    );
  });

  it('rotates a full page of failed counter repairs to reach a later sequence', async () => {
    const failedSequences = Array.from(
      { length: SEQUENCE_METRICS_RECONCILE_BATCH_SIZE },
      (_, index) =>
        ({
          id: `failed-metrics-${index}`,
          updatedAt: '2024-01-01T09:00:00.000Z',
        }) as SequenceWorkspaceEntity,
    );
    const laterSequence = {
      id: 'later-metrics-sequence',
      updatedAt: '2024-01-01T09:01:00.000Z',
    } as SequenceWorkspaceEntity;
    const {
      service,
      sequenceRepository,
      recomputeForSequenceInCurrentContext,
    } = setup({ startedToday: 2 });
    const defaultFind = sequenceRepository.find.getMockImplementation();
    let stalePage = 0;

    sequenceRepository.find.mockImplementation(async (options) => {
      if (options.withDeleted) {
        return stalePage++ === 0 ? failedSequences : [laterSequence];
      }

      return defaultFind?.(options) ?? [];
    });
    recomputeForSequenceInCurrentContext.mockImplementation(
      async ({ sequenceId }: { sequenceId: string }) => {
        if (sequenceId.startsWith('failed-metrics-')) {
          throw new Error('row-specific metrics failure');
        }
      },
    );

    await service.tick(workspaceId, now);

    expect(sequenceRepository.update).toHaveBeenCalledTimes(
      SEQUENCE_METRICS_RECONCILE_BATCH_SIZE,
    );
    expect(recomputeForSequenceInCurrentContext).not.toHaveBeenCalledWith(
      expect.objectContaining({ sequenceId: laterSequence.id }),
    );

    await service.tick(workspaceId, new Date(now.getTime() + 1));

    expect(recomputeForSequenceInCurrentContext).toHaveBeenCalledWith({
      workspaceId,
      sequenceId: laterSequence.id,
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

  it('rotates an enrollment while its LinkedIn action is still scheduled', async () => {
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

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'waiting-id',
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        currentStepId: 'linkedin-step-id',
        updatedAt: expectMillisecondPrecisionDateCondition(
          waitingEnrollment.updatedAt,
        ),
      }),
      { updatedAt: now.toISOString() },
    );
  });

  it('rotates past a full page of open LinkedIn waits to repair a later terminal row', async () => {
    const openWaiters = Array.from(
      { length: SEQUENCE_SCHEDULER_BATCH_SIZE },
      (_, index) =>
        ({
          ...buildEnrollment(`open-linkedin-${index}`),
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
          currentStepId: `linkedin-step-${index}`,
          nextActionAt: null,
        }) as SequenceEnrollmentWorkspaceEntity,
    );
    const terminalWaiter = {
      ...buildEnrollment('terminal-linkedin'),
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      currentStepId: 'terminal-linkedin-step',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const openActions = openWaiters.map(
      (enrollment, index) =>
        ({
          id: `open-linkedin-action-${index}`,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          sequenceEnrollmentId: enrollment.id,
          sequenceStepId: enrollment.currentStepId,
        }) as LinkedinActionWorkspaceEntity,
    );
    const terminalAction = {
      id: 'terminal-linkedin-action',
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      sequenceEnrollmentId: terminalWaiter.id,
      sequenceStepId: terminalWaiter.currentStepId,
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      enqueueProcess,
    } = setup({ startedToday: 2 });
    const defaultEnrollmentFind =
      enrollmentRepository.find.getMockImplementation();
    const defaultActionFind =
      linkedinActionRepository.find.getMockImplementation();
    let waitingPage = 0;
    let actionPage = 0;

    enrollmentRepository.find.mockImplementation(async (options) => {
      if (options.where.waitingOn === SEQUENCE_WAITING_ON.LINKEDIN_ACTION) {
        return waitingPage++ === 0 ? openWaiters : [terminalWaiter];
      }

      return defaultEnrollmentFind?.(options) ?? [];
    });
    linkedinActionRepository.find.mockImplementation(async (options) => {
      const where = Array.isArray(options.where)
        ? options.where[0]
        : options.where;

      if (where.sequenceEnrollmentId) {
        return actionPage++ === 0 ? openActions : [terminalAction];
      }

      return defaultActionFind?.(options) ?? [];
    });

    await service.tick(workspaceId, now);

    const rotationCalls = enrollmentRepository.update.mock.calls.filter(
      ([, data]) => data.updatedAt === now.toISOString(),
    );

    expect(rotationCalls).toHaveLength(SEQUENCE_SCHEDULER_BATCH_SIZE);
    expect(enqueueProcess).not.toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: terminalWaiter.id,
    });

    await service.tick(workspaceId, new Date(now.getTime() + 1));

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: terminalWaiter.id }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: terminalWaiter.id,
    });
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
          id: 'completed-task-id',
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
      taskId: 'completed-task-id',
    });
  });

  it('rotates past a full page of open task waits to repair a later completed row', async () => {
    const openWaiters = Array.from(
      { length: SEQUENCE_SCHEDULER_BATCH_SIZE },
      (_, index) =>
        ({
          ...buildEnrollment(`open-task-${index}`),
          waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
          currentStepId: `task-step-${index}`,
          nextActionAt: null,
        }) as SequenceEnrollmentWorkspaceEntity,
    );
    const completedWaiter = {
      ...buildEnrollment('completed-task'),
      waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
      currentStepId: 'completed-task-step',
      nextActionAt: null,
    } as SequenceEnrollmentWorkspaceEntity;
    const openTasks = openWaiters.map((enrollment) => ({
      id: `${enrollment.id}-task`,
      sequenceEnrollmentId: enrollment.id,
      sequenceStepId: enrollment.currentStepId,
      status: 'TODO',
    }));
    const completedTask = {
      id: 'completed-task-id',
      sequenceEnrollmentId: completedWaiter.id,
      sequenceStepId: completedWaiter.currentStepId,
      status: 'DONE',
    };
    const { service, enrollmentRepository, taskRepository, completeTaskStep } =
      setup({ startedToday: 2 });
    const defaultEnrollmentFind =
      enrollmentRepository.find.getMockImplementation();
    let waitingPage = 0;
    let taskPage = 0;

    enrollmentRepository.find.mockImplementation(async (options) => {
      if (
        options.where.updatedAt &&
        options.where.waitingOn !== SEQUENCE_WAITING_ON.LINKEDIN_ACTION
      ) {
        return waitingPage++ === 0 ? openWaiters : [completedWaiter];
      }

      return defaultEnrollmentFind?.(options) ?? [];
    });
    taskRepository.find.mockImplementation(async () =>
      taskPage++ === 0 ? openTasks : [completedTask],
    );

    await service.tick(workspaceId, now);

    const rotationCalls = enrollmentRepository.update.mock.calls.filter(
      ([, data]) => data.updatedAt === now.toISOString(),
    );

    expect(rotationCalls).toHaveLength(SEQUENCE_SCHEDULER_BATCH_SIZE);
    expect(completeTaskStep).not.toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: completedWaiter.id }),
    );

    const secondTickNow = new Date(now.getTime() + 1);

    await service.tick(workspaceId, secondTickNow);

    expect(completeTaskStep).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: completedWaiter.id,
      stepId: completedWaiter.currentStepId,
      taskId: completedTask.id,
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
        updatedAt: expectMillisecondPrecisionDateCondition(
          waitingEnrollment.updatedAt,
        ),
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: 'SEQUENCE_TASK_MISSING',
      }),
    );
  });

  it('fails only the exact task waiter snapshot when its current step is missing', async () => {
    const waitingEnrollment = {
      ...buildEnrollment('task-waiting-without-step-id'),
      waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
      currentStepId: null,
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
        currentStepId: IsNull(),
        updatedAt: expectMillisecondPrecisionDateCondition(
          waitingEnrollment.updatedAt,
        ),
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: 'SEQUENCE_TASK_STEP_MISSING',
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

  it('does not reserve a mailbox slot when scheduling authorization loses its CAS', async () => {
    const racedEnrollment = buildEnrollment('raced-due-id');
    const schedulableEnrollment = buildEnrollment('schedulable-due-id');
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 2,
      dueEnrollments: [racedEnrollment, schedulableEnrollment],
    });

    enrollmentRepository.update.mockResolvedValueOnce({ affected: 0 });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: schedulableEnrollment.id }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: now,
      }),
    );
    expect(enqueueProcess).toHaveBeenCalledTimes(1);
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: schedulableEnrollment.id,
    });
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
      token: 'mailbox-lock-token',
    });
    expect(acquireSendLock.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueProcess.mock.invocationCallOrder[0],
    );
    expect(enqueueProcess.mock.invocationCallOrder[0]).toBeLessThan(
      releaseSendLock.mock.invocationCallOrder[0],
    );
  });

  it('leaves an enrollment recovering a phone enrichment on its own step', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
      settings: { type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER },
    } as SequenceStepWorkspaceEntity;
    const emailStep = { ...step, position: 1 } as SequenceStepWorkspaceEntity;
    // Due on the enrichment lease, not because the step finished. Scheduling
    // the following step here would drop the enrichment the executor still owns.
    const enrichmentWaiter = {
      ...buildEnrollment('enrichment-waiter-id'),
      currentStepId: enrichStep.id,
      currentStepPosition: enrichStep.position,
      waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, enqueueProcess } = setup({
      startedToday: 2,
      dueEnrollments: [enrichmentWaiter],
      steps: [enrichStep, emailStep],
    });

    await service.tick(workspaceId, now);

    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId: enrichmentWaiter.id,
    });
  });
});
