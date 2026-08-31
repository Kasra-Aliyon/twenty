import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  SEQUENCE_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';

import { CommonQueryRunnerExceptionCode } from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type SequenceLinkedinActionReportInput } from 'src/modules/sequence/dtos/sequence-linkedin-action-report.input';
import { type SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import {
  DEFAULT_SEQUENCE_SETTINGS,
  DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
} from 'src/modules/sequence/sequence.constants';
import { type SequenceEmailReplyReconciliationService } from 'src/modules/sequence/services/sequence-email-reply-reconciliation.service';
import { SequenceLinkedinActionMutationService } from 'src/modules/sequence/services/sequence-linkedin-action-mutation.service';
import { type SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

describe('SequenceLinkedinActionMutationService', () => {
  const workspaceId = 'workspace-id';
  const workspaceMemberId = 'workspace-member-id';
  const claimedBy = 'extension-tab-42';
  const claimedAt = new Date('2026-08-17T09:01:59.000Z');
  const executedAt = new Date('2026-08-17T09:02:30.000Z');
  const workspaceMemberRepository = {
    findOne: jest.fn().mockResolvedValue({ id: workspaceMemberId }),
  };
  const transactionManager = {
    getRepository: jest.fn((entityTarget) => {
      if (entityTarget === 'workspaceMember') {
        return workspaceMemberRepository;
      }

      throw new Error('Unexpected transactional repository');
    }),
  } as unknown as WorkspaceEntityManager;
  const action = {
    id: 'action-id',
    type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
    status: LINKEDIN_ACTION_STATUSES.CLAIMED,
    scheduledAt: new Date('2026-08-17T09:00:00.000Z'),
    claimedAt,
    claimedBy,
    executedAt: null,
    attemptCount: 0,
    errorMessage: null,
    ownerWorkspaceMemberId: workspaceMemberId,
    linkedinUrl: 'https://www.linkedin.com/in/example/',
    noteText: 'Hello',
    connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
    personId: 'person-id',
    sequenceEnrollmentId: 'enrollment-id',
    sequenceStepId: 'step-id',
  } as LinkedinActionWorkspaceEntity;
  const unlinkedAction = {
    ...action,
    sequenceEnrollmentId: null,
    sequenceStepId: null,
  } as LinkedinActionWorkspaceEntity;

  const setup = ({
    actionCandidate = {
      id: action.id,
      sequenceEnrollmentId: action.sequenceEnrollmentId,
      sequenceStepId: action.sequenceStepId,
    },
    enrollmentStatus = SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
    enrollmentWaitingOn = SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
    enrollmentCurrentStepId = action.sequenceStepId,
    enrollmentDeletedAt = null,
    lockedAction = action,
    replacementScheduledAt = null,
    linkedinReplyReconciledBeforeStart = false,
    replyReconciledBeforeStart = false,
    sequenceSettings = DEFAULT_SEQUENCE_SETTINGS,
    sequenceStatus = SEQUENCE_STATUSES.ACTIVE,
    sequenceDeletedAt = null,
    updateAffected = 1,
  }: {
    actionCandidate?: Partial<LinkedinActionWorkspaceEntity> | null;
    enrollmentStatus?: string;
    enrollmentWaitingOn?: string | null;
    enrollmentCurrentStepId?: string | null;
    enrollmentDeletedAt?: string | null;
    lockedAction?: LinkedinActionWorkspaceEntity | null;
    replacementScheduledAt?: Date | null;
    linkedinReplyReconciledBeforeStart?: boolean;
    replyReconciledBeforeStart?: boolean;
    sequenceSettings?: unknown;
    sequenceStatus?: string;
    sequenceDeletedAt?: string | null;
    updateAffected?: number;
  } = {}) => {
    const actionRepository = {
      findOne: jest
        .fn()
        .mockImplementation(async (options) =>
          options.lock ? lockedAction : actionCandidate,
        ),
      update: jest.fn().mockResolvedValue({ affected: updateAffected }),
    };
    const enrollmentRepository = {
      findOne: jest.fn().mockImplementation(async (options) => {
        if (options.select?.includes('sentEmailsByStepId')) {
          return {
            id: action.sequenceEnrollmentId,
            personId: action.personId,
            sentEmailsByStepId: {},
          };
        }

        if (options.select?.includes('sequenceId')) {
          return {
            id: action.sequenceEnrollmentId,
            sequenceId: 'sequence-id',
          };
        }

        return {
          id: action.sequenceEnrollmentId,
          currentStepId: enrollmentCurrentStepId,
          status: enrollmentStatus,
          waitingOn: enrollmentWaitingOn,
          deletedAt: enrollmentDeletedAt,
        };
      }),
      update: jest.fn().mockResolvedValue({ affected: updateAffected }),
    };
    const sequenceRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'sequence-id',
        settings: sequenceSettings,
        status: sequenceStatus,
        deletedAt: sequenceDeletedAt,
      }),
    };
    const reserveClaimSlotIfTooEarly = jest
      .fn()
      .mockResolvedValue(replacementScheduledAt);
    const reserveClaimSlotIfDailyCapExceeded = jest
      .fn()
      .mockResolvedValue(null);
    const reserveSlot = jest.fn().mockResolvedValue(replacementScheduledAt);
    const sequenceLinkedinThrottleService = {
      reserveClaimSlotIfDailyCapExceeded,
      reserveClaimSlotIfTooEarly,
      reserveSlot,
    } as unknown as SequenceLinkedinThrottleService;
    const reconcileBeforeEnrollmentProgress = jest
      .fn()
      .mockResolvedValue(replyReconciledBeforeStart);
    const sequenceEmailReplyReconciliationService = {
      reconcileBeforeEnrollmentProgress,
    } as unknown as SequenceEmailReplyReconciliationService;
    const reconcileEnrollmentBeforeProviderStart = jest
      .fn()
      .mockResolvedValue(linkedinReplyReconciledBeforeStart);
    const sequenceLinkedinReplyListener = {
      reconcileEnrollmentBeforeProviderStart,
    } as unknown as SequenceLinkedinReplyListener;
    const repositories = new Map<object, object>([
      [LinkedinActionWorkspaceEntity, actionRepository],
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceWorkspaceEntity, sequenceRepository],
    ]);
    const transaction = jest.fn(async (operation) =>
      operation(transactionManager),
    );
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (operation) => operation()),
      getGlobalWorkspaceDataSource: jest
        .fn()
        .mockResolvedValue({ transaction }),
      getRepository: jest.fn(async (_workspaceId, entity) =>
        repositories.get(entity),
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const service = new SequenceLinkedinActionMutationService(
      globalWorkspaceOrmManager,
      sequenceEmailReplyReconciliationService,
      sequenceLinkedinReplyListener,
      sequenceLinkedinThrottleService,
    );

    return {
      actionRepository,
      enrollmentRepository,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      reserveClaimSlotIfDailyCapExceeded,
      reserveClaimSlotIfTooEarly,
      reserveSlot,
      sequenceRepository,
      service,
      transaction,
      workspaceMemberRepository,
    };
  };

  it('renews the provider-start lease without changing the report CAS identity', async () => {
    const {
      actionRepository,
      enrollmentRepository,
      sequenceRepository,
      service,
    } = setup();

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: executedAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: action.id,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        claimedAt,
        claimedBy,
        executedAt,
      }),
    );
    expect(sequenceRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sequence-id' },
        select: ['id', 'status', 'settings', 'deletedAt'],
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(enrollmentRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'enrollment-id', sequenceId: 'sequence-id' },
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(transactionManager.getRepository).toHaveBeenCalledWith(
      'workspaceMember',
      { shouldBypassPermissionChecks: true },
    );
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: action.id,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        claimedAt,
        claimedBy,
      }),
      { executedAt },
      transactionManager,
    );
  });

  it('releases and re-slots an old-day claim against the provider-start day cap', async () => {
    const providerStartAt = new Date('2026-08-18T00:01:00.000Z');
    const replacementScheduledAt = new Date('2026-08-19T09:00:00.000Z');
    const capOneSettings = {
      ...DEFAULT_SEQUENCE_SETTINGS,
      linkedinDailyActionLimitEnabled: true,
      linkedinDailyActions: 1,
    };
    const {
      actionRepository,
      reserveClaimSlotIfTooEarly,
      reserveSlot,
      service,
    } = setup({
      lockedAction: { ...action, type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE },
      replacementScheduledAt,
      sequenceSettings: capOneSettings,
    });

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: providerStartAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: action.id,
        type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
      }),
    );

    expect(reserveClaimSlotIfTooEarly).not.toHaveBeenCalled();
    expect(reserveSlot).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: capOneSettings,
      now: providerStartAt,
      transactionManager,
      excludedActionId: action.id,
    });
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: action.id,
        claimedAt,
        claimedBy,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      }),
      {
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
      },
      transactionManager,
    );
  });

  it('re-slots a linked claim at provider start using the fixed sequence timezone', async () => {
    const providerStartAt = new Date('2026-08-18T00:01:00.000Z');
    const replacementScheduledAt = new Date('2026-08-18T16:00:00.000Z');
    const { reserveSlot, service } = setup({
      replacementScheduledAt,
      sequenceSettings: {
        ...DEFAULT_SEQUENCE_SETTINGS,
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        timezone: 'Europe/Helsinki',
      },
    });

    await service.start({
      workspaceId,
      workspaceMemberId,
      actionId: action.id,
      claimedBy,
      claimedAt,
      now: providerStartAt,
    });

    expect(reserveSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          timezone: 'Europe/Helsinki',
        }),
      }),
    );
  });

  it('revalidates an unlinked action against the direct-action UTC cap at provider start', async () => {
    const providerStartAt = new Date('2026-08-18T00:01:00.000Z');
    const replacementScheduledAt = new Date('2026-08-18T00:02:00.000Z');
    const priorDayUnlinkedAction = {
      ...unlinkedAction,
      scheduledAt: new Date('2026-08-17T23:59:00.000Z'),
    } as LinkedinActionWorkspaceEntity;
    const { actionRepository, reserveSlot, service } = setup({
      actionCandidate: priorDayUnlinkedAction,
      lockedAction: priorDayUnlinkedAction,
      replacementScheduledAt,
    });

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: priorDayUnlinkedAction.id,
        claimedBy,
        claimedAt,
        now: providerStartAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
      }),
    );

    expect(reserveSlot).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: DIRECT_LINKEDIN_ACTION_THROTTLE_SETTINGS,
      now: providerStartAt,
      transactionManager,
      excludedActionId: priorDayUnlinkedAction.id,
    });
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceEnrollmentId: expect.anything(),
        sequenceStepId: expect.anything(),
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
      }),
      transactionManager,
    );
  });

  it('releases and re-slots a claim when another device finishes preflight first', async () => {
    const providerStartAt = new Date('2026-08-17T09:08:00.000Z');
    const replacementScheduledAt = new Date('2026-08-17T09:13:00.000Z');
    const { actionRepository, reserveClaimSlotIfTooEarly, service } = setup({
      replacementScheduledAt,
    });

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: providerStartAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: action.id,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
      }),
    );

    expect(reserveClaimSlotIfTooEarly).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: DEFAULT_SEQUENCE_SETTINGS,
      now: providerStartAt,
      transactionManager,
      actionId: action.id,
      actionScheduledAt: action.scheduledAt,
    });
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: action.id,
        claimedAt,
        claimedBy,
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
        executedAt: null,
      }),
      transactionManager,
    );
  });

  it('re-slots a linked claim at provider start when a direct action filled the same-day cap', async () => {
    const providerStartAt = new Date('2026-08-17T09:01:00.000Z');
    const replacementScheduledAt = new Date('2026-08-18T09:00:00.000Z');
    const cappedSettings = {
      ...DEFAULT_SEQUENCE_SETTINGS,
      linkedinDailyActionLimitEnabled: true,
      linkedinDailyActions: 1,
    };
    const {
      actionRepository,
      reserveClaimSlotIfDailyCapExceeded,
      reserveClaimSlotIfTooEarly,
      service,
    } = setup({
      sequenceSettings: cappedSettings,
    });

    reserveClaimSlotIfDailyCapExceeded.mockResolvedValueOnce(
      replacementScheduledAt,
    );

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: providerStartAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
      }),
    );

    expect(reserveClaimSlotIfDailyCapExceeded).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: cappedSettings,
      now: providerStartAt,
      transactionManager,
      actionId: action.id,
      actionScheduledAt: action.scheduledAt,
    });
    expect(reserveClaimSlotIfTooEarly).not.toHaveBeenCalled();
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: action.id,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
      }),
      transactionManager,
    );
  });

  it('re-slots a claim whose browser preflight finishes after the sending window closes', async () => {
    const providerStartAt = new Date('2026-08-17T18:00:00.000Z');
    const replacementScheduledAt = new Date('2026-08-18T09:00:00.000Z');
    const {
      actionRepository,
      reserveClaimSlotIfDailyCapExceeded,
      reserveClaimSlotIfTooEarly,
      reserveSlot,
      service,
    } = setup({
      replacementScheduledAt,
      sequenceSettings: {
        ...DEFAULT_SEQUENCE_SETTINGS,
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        timezone: 'UTC',
        windowStart: '09:00',
        windowEnd: '17:00',
      },
    });

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: providerStartAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
      }),
    );

    expect(reserveSlot).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: expect.objectContaining({ windowEnd: '17:00' }),
      now: providerStartAt,
      transactionManager,
      excludedActionId: action.id,
    });
    expect(reserveClaimSlotIfDailyCapExceeded).not.toHaveBeenCalled();
    expect(reserveClaimSlotIfTooEarly).not.toHaveBeenCalled();
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: action.id }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        scheduledAt: replacementScheduledAt,
      }),
      transactionManager,
    );
  });

  it('captures the provider-start UTC day only after acquiring the owner lock', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-17T23:59:59.000Z'));

    try {
      const priorDayAction = {
        ...action,
        scheduledAt: new Date('2026-08-17T23:59:00.000Z'),
      } as LinkedinActionWorkspaceEntity;
      const replacementScheduledAt = new Date('2026-08-18T00:05:00.000Z');
      const {
        reserveSlot,
        service,
        workspaceMemberRepository: lockedOwnerRepository,
      } = setup({
        actionCandidate: priorDayAction,
        lockedAction: priorDayAction,
        replacementScheduledAt,
        sequenceSettings: {
          ...DEFAULT_SEQUENCE_SETTINGS,
          activeDays: [0, 1, 2, 3, 4, 5, 6],
          timezone: 'UTC',
          windowStart: '00:00',
          windowEnd: '00:00',
        },
      });

      lockedOwnerRepository.findOne.mockImplementationOnce(async () => {
        jest.setSystemTime(new Date('2026-08-18T00:01:00.000Z'));

        return { id: workspaceMemberId };
      });

      await service.start({
        workspaceId,
        workspaceMemberId,
        actionId: priorDayAction.id,
        claimedBy,
        claimedAt,
      });

      expect(reserveSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          now: new Date('2026-08-18T00:01:00.000Z'),
          excludedActionId: priorDayAction.id,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('idempotently renews the same stable claim after a committed start response is lost', async () => {
    const firstStart = setup();

    await expect(
      firstStart.service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: executedAt,
      }),
    ).resolves.toEqual(expect.objectContaining({ claimedAt, executedAt }));

    const retryStartedAt = new Date('2026-08-17T09:03:00.000Z');
    const retry = setup({ lockedAction: { ...action, executedAt } });

    await expect(
      retry.service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: retryStartedAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        claimedAt,
        claimedBy,
        executedAt: retryStartedAt,
      }),
    );
    expect(retry.actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ claimedAt, claimedBy }),
      { executedAt: retryStartedAt },
      transactionManager,
    );
  });

  it('rejects provider start after the sequence was paused', async () => {
    const { actionRepository, service } = setup({
      sequenceStatus: SEQUENCE_STATUSES.PAUSED,
    });

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: executedAt,
      }),
    ).resolves.toBeNull();
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('rejects provider start after the sequence was archived', async () => {
    const { actionRepository, service } = setup({
      sequenceDeletedAt: '2026-08-17T09:02:00.000Z',
    });

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: executedAt,
      }),
    ).resolves.toBeNull();
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('reconciles a committed fresh-thread reply before authorizing a claimed action', async () => {
    const {
      actionRepository,
      enrollmentRepository,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      service,
      transaction,
    } = setup({ replyReconciledBeforeStart: true });

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: executedAt,
      }),
    ).resolves.toBeNull();

    expect(reconcileBeforeEnrollmentProgress).toHaveBeenCalledWith({
      workspaceId,
      enrollment: expect.objectContaining({
        id: action.sequenceEnrollmentId,
        personId: action.personId,
      }),
      enrollmentRepository,
    });
    expect(reconcileEnrollmentBeforeProviderStart).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('replays a committed LinkedIn reply before authorizing a claimed action', async () => {
    const {
      actionRepository,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      service,
      transaction,
    } = setup({ linkedinReplyReconciledBeforeStart: true });

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: executedAt,
      }),
    ).resolves.toBeNull();

    expect(reconcileBeforeEnrollmentProgress).toHaveBeenCalled();
    expect(reconcileEnrollmentBeforeProviderStart).toHaveBeenCalledWith({
      sequenceEnrollmentId: action.sequenceEnrollmentId,
      workspaceId,
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('rejects provider start when the scheduler already won the claim lock', async () => {
    const { actionRepository, service } = setup({ lockedAction: null });

    await expect(
      service.start({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        now: executedAt,
      }),
    ).resolves.toBeNull();
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('reports a terminal result with an owner-and-lease CAS under sequence lock order', async () => {
    const {
      actionRepository,
      enrollmentRepository,
      sequenceRepository,
      service,
    } = setup({ lockedAction: { ...action, executedAt } });

    await expect(
      service.report({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        data: {
          status: LINKEDIN_ACTION_STATUSES.COMPLETED,
          connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
          executedAt,
        },
      }),
    ).resolves.toEqual({
      id: action.id,
      type: action.type,
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      scheduledAt: action.scheduledAt,
      claimedAt,
      claimedBy,
      executedAt,
      linkedinUrl: action.linkedinUrl,
      noteText: action.noteText,
      connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
      errorMessage: null,
    });

    expect(sequenceRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sequence-id' },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(enrollmentRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'enrollment-id', sequenceId: 'sequence-id' },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(actionRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: action.id,
          ownerWorkspaceMemberId: workspaceMemberId,
          status: LINKEDIN_ACTION_STATUSES.CLAIMED,
          claimedAt,
          claimedBy,
        }),
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(sequenceRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      enrollmentRepository.findOne.mock.invocationCallOrder[1],
    );
    expect(
      enrollmentRepository.findOne.mock.invocationCallOrder[1],
    ).toBeLessThan(actionRepository.findOne.mock.invocationCallOrder[1]);
    expect(actionRepository.update).toHaveBeenCalledWith(
      {
        id: action.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: action.sequenceEnrollmentId,
        sequenceStepId: action.sequenceStepId,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        claimedAt,
        claimedBy,
      },
      {
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        errorMessage: null,
        executedAt,
      },
      transactionManager,
    );
  });

  it.each([
    LINKEDIN_ACTION_STATUSES.FAILED,
    LINKEDIN_ACTION_STATUSES.COMPLETED,
  ])(
    'terminally fails a pre-start %s report once instead of trusting browser outcome data',
    async (reportedStatus) => {
      const now = new Date('2026-08-17T09:03:00.000Z');
      const { actionRepository, enrollmentRepository, reserveSlot, service } =
        setup();
      const expectedErrorMessage = `${SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED}: Forged terminal result`;

      await expect(
        service.report({
          workspaceId,
          workspaceMemberId,
          actionId: action.id,
          claimedBy,
          claimedAt,
          data: {
            status: reportedStatus,
            connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
            executedAt: new Date('2026-08-17T09:02:45.000Z'),
            errorMessage: 'Forged terminal result',
          },
          now,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          executedAt: null,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          errorMessage: expectedErrorMessage,
        }),
      );
      expect(reserveSlot).not.toHaveBeenCalled();
      expect(actionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: action.id, claimedAt, claimedBy }),
        {
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          errorMessage: expectedErrorMessage,
          executedAt: null,
        },
        transactionManager,
      );
      expect(enrollmentRepository.update).toHaveBeenCalledWith(
        {
          id: action.sequenceEnrollmentId,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
          currentStepId: action.sequenceStepId,
        },
        {
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
          waitingOn: null,
          nextActionAt: null,
          endedAt: now,
          errorMessage: expectedErrorMessage,
        },
        transactionManager,
      );
    },
  );

  it.each([
    LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
    LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
    LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
  ])('does not retry an explicit preflight failure for %s', async (type) => {
    const { actionRepository, reserveSlot, service } = setup({
      lockedAction: { ...action, type, attemptCount: 2 },
    });

    await expect(
      service.report({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        data: {
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          errorMessage: 'Provider control not found',
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        type,
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        errorMessage: `${SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED}: Provider control not found`,
      }),
    );
    expect(reserveSlot).not.toHaveBeenCalled();
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({
        attemptCount: expect.anything(),
        scheduledAt: expect.anything(),
      }),
      transactionManager,
    );
  });

  it.each([SEQUENCE_STATUSES.PAUSED, SEQUENCE_STATUSES.DRAFT])(
    'quiesces a pre-start failure reported after the sequence became %s',
    async (sequenceStatus) => {
      const now = new Date('2026-08-17T09:03:00.000Z');
      const { actionRepository, enrollmentRepository, reserveSlot, service } =
        setup({ sequenceStatus });

      await expect(
        service.report({
          workspaceId,
          workspaceMemberId,
          actionId: action.id,
          claimedBy,
          claimedAt,
          data: {
            status: LINKEDIN_ACTION_STATUSES.FAILED,
            connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          },
          now,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          claimedAt: null,
          claimedBy: null,
          errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
        }),
      );
      expect(reserveSlot).not.toHaveBeenCalled();
      expect(actionRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ attemptCount: expect.anything() }),
        transactionManager,
      );
      expect(enrollmentRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: action.sequenceEnrollmentId,
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
          currentStepId: action.sequenceStepId,
        }),
        {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: now,
        },
        transactionManager,
      );
    },
  );

  it('fails a direct explicit preflight report once without an enrollment', async () => {
    const now = new Date('2026-08-17T09:03:00.000Z');
    const { enrollmentRepository, reserveSlot, service } = setup({
      actionCandidate: {
        id: unlinkedAction.id,
        sequenceEnrollmentId: null,
        sequenceStepId: null,
      },
      lockedAction: unlinkedAction,
    });

    await expect(
      service.report({
        workspaceId,
        workspaceMemberId,
        actionId: unlinkedAction.id,
        claimedBy,
        claimedAt,
        data: {
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          errorMessage: 'Message control not found',
        },
        now,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        errorMessage: `${SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED}: Message control not found`,
      }),
    );
    expect(reserveSlot).not.toHaveBeenCalled();
    expect(enrollmentRepository.findOne).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('advances an authoritative pre-start skip without fabricating provider activity', async () => {
    const { actionRepository, reserveSlot, service } = setup();

    await expect(
      service.report({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        data: {
          status: LINKEDIN_ACTION_STATUSES.SKIPPED,
          connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
          executedAt,
          errorMessage: 'Invitation is already pending',
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SKIPPED,
        executedAt: null,
        connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
        errorMessage: 'Invitation is already pending',
      }),
    );
    expect(reserveSlot).not.toHaveBeenCalled();
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      {
        status: LINKEDIN_ACTION_STATUSES.SKIPPED,
        connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
        errorMessage: 'Invitation is already pending',
        executedAt: null,
      },
      transactionManager,
    );
  });

  it('preserves the authoritative server provider-start time when reporting', async () => {
    const serverStartedAt = new Date('2026-08-17T09:02:00.000Z');
    const { actionRepository, service } = setup({
      lockedAction: { ...action, executedAt: serverStartedAt },
    });

    await expect(
      service.report({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        data: {
          status: LINKEDIN_ACTION_STATUSES.COMPLETED,
          connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
          executedAt: new Date('2026-08-17T09:02:45.000Z'),
        },
        now: new Date('2026-08-17T09:03:00.000Z'),
      }),
    ).resolves.toEqual(
      expect.objectContaining({ executedAt: serverStartedAt }),
    );
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ executedAt: serverStartedAt }),
      transactionManager,
    );
  });

  it('cancels an unstarted report after its enrollment moved on without failing it again', async () => {
    const { actionRepository, enrollmentRepository, reserveSlot, service } =
      setup({
        enrollmentStatus: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
        enrollmentWaitingOn: null,
      });

    await expect(
      service.report({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        data: {
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          errorMessage: 'Browser failed',
        },
        now: executedAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
      }),
    );
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: action.id, claimedAt, claimedBy }),
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        claimedAt: null,
        claimedBy: null,
        connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
        executedAt: null,
      }),
      transactionManager,
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(reserveSlot).not.toHaveBeenCalled();
  });

  it('preserves an ambiguous failure after the server committed provider start', async () => {
    const { actionRepository, service } = setup({
      lockedAction: { ...action, executedAt },
    });

    await expect(
      service.report({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
        data: {
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          errorMessage: 'Browser outcome unknown',
        },
        now: new Date('2026-08-17T09:03:00.000Z'),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.FAILED,
        errorMessage: 'Browser outcome unknown',
        executedAt,
      }),
    );
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorMessage: 'Browser outcome unknown',
        executedAt,
      }),
      transactionManager,
    );
  });

  it('preserves reporting for an unlinked manual action claimed by the runner', async () => {
    const {
      actionRepository,
      enrollmentRepository,
      sequenceRepository,
      service,
    } = setup({
      actionCandidate: {
        id: unlinkedAction.id,
        sequenceEnrollmentId: null,
        sequenceStepId: null,
      },
      lockedAction: { ...unlinkedAction, executedAt },
    });

    await expect(
      service.report({
        workspaceId,
        workspaceMemberId,
        actionId: unlinkedAction.id,
        claimedBy,
        claimedAt,
        data: {
          status: LINKEDIN_ACTION_STATUSES.COMPLETED,
          connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
          executedAt,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: unlinkedAction.id,
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      }),
    );

    expect(enrollmentRepository.findOne).not.toHaveBeenCalled();
    expect(sequenceRepository.findOne).not.toHaveBeenCalled();
    expect(actionRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sequenceEnrollmentId: expect.anything(),
          sequenceStepId: expect.anything(),
          claimedBy,
          claimedAt,
        }),
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
  });

  it('returns null without writing when the owner lease is stale', async () => {
    const { actionRepository, service } = setup({ lockedAction: null });

    await expect(
      service.report({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'different-runner',
        claimedAt,
        data: {
          status: LINKEDIN_ACTION_STATUSES.COMPLETED,
          connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        },
      }),
    ).resolves.toBeNull();

    expect(actionRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ claimedBy: 'different-runner' }),
      }),
      transactionManager,
    );
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      data: {
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
      },
    },
    {
      data: {
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        connectionState: 'FORGED_CONNECTION_STATE',
      },
    },
  ])(
    'rejects an invalid terminal report before opening a transaction',
    async ({ data }) => {
      const { service, transaction } = setup();

      await expect(
        service.report({
          workspaceId,
          workspaceMemberId,
          actionId: action.id,
          claimedBy,
          claimedAt,
          data: data as SequenceLinkedinActionReportInput,
        }),
      ).rejects.toMatchObject({
        code: CommonQueryRunnerExceptionCode.BAD_REQUEST,
      });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('releases a current claim back to scheduled and clears its lease', async () => {
    const { actionRepository, service } = setup();

    await expect(
      service.release({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: action.id,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        claimedAt: null,
        claimedBy: null,
      }),
    );

    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: action.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        claimedAt,
        claimedBy,
      }),
      {
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
      },
      transactionManager,
    );
  });

  it('preserves claim release for an unlinked manual action', async () => {
    const { actionRepository, enrollmentRepository, service } = setup({
      actionCandidate: {
        id: unlinkedAction.id,
        sequenceEnrollmentId: null,
        sequenceStepId: null,
      },
      lockedAction: unlinkedAction,
    });

    await expect(
      service.release({
        workspaceId,
        workspaceMemberId,
        actionId: unlinkedAction.id,
        claimedBy,
        claimedAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        claimedAt: null,
        claimedBy: null,
      }),
    );

    expect(enrollmentRepository.findOne).not.toHaveBeenCalled();
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: unlinkedAction.id,
        sequenceEnrollmentId: expect.anything(),
        sequenceStepId: expect.anything(),
        claimedBy,
        claimedAt,
      }),
      {
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        claimedAt: null,
        claimedBy: null,
        executedAt: null,
      },
      transactionManager,
    );
  });

  it.each([
    {
      sequenceStatus: SEQUENCE_STATUSES.PAUSED,
      expectedErrorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
    },
    {
      sequenceStatus: SEQUENCE_STATUSES.DRAFT,
      expectedErrorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
    },
  ])(
    'cancels an unstarted claim instead of rescheduling it when its sequence is $sequenceStatus',
    async ({ sequenceStatus, expectedErrorMessage }) => {
      const { actionRepository, service } = setup({ sequenceStatus });

      await expect(
        service.release({
          workspaceId,
          workspaceMemberId,
          actionId: action.id,
          claimedBy,
          claimedAt,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          errorMessage: expectedErrorMessage,
        }),
      );
      expect(actionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: action.id, claimedAt, claimedBy }),
        {
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          claimedAt: null,
          claimedBy: null,
          executedAt: null,
          errorMessage: expectedErrorMessage,
        },
        transactionManager,
      );
    },
  );

  it.each([
    {
      enrollmentStatus: SEQUENCE_ENROLLMENT_STATUSES.COMPLETED,
      enrollmentWaitingOn: null,
      enrollmentCurrentStepId: action.sequenceStepId,
    },
    {
      enrollmentStatus: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      enrollmentWaitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      enrollmentCurrentStepId: 'new-step-id',
    },
  ])(
    'cancels a provably unstarted claim after its enrollment moved on',
    async ({
      enrollmentStatus,
      enrollmentWaitingOn,
      enrollmentCurrentStepId,
    }) => {
      const { actionRepository, service } = setup({
        enrollmentStatus,
        enrollmentWaitingOn,
        enrollmentCurrentStepId,
      });

      await expect(
        service.release({
          workspaceId,
          workspaceMemberId,
          actionId: action.id,
          claimedBy,
          claimedAt,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          id: action.id,
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          claimedAt: null,
          claimedBy: null,
          executedAt: null,
          errorMessage: SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
        }),
      );
      expect(actionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: action.id,
          claimedAt,
          claimedBy,
          status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        }),
        {
          status: LINKEDIN_ACTION_STATUSES.CANCELLED,
          claimedAt: null,
          claimedBy: null,
          executedAt: null,
          errorMessage: SEQUENCE_LINKEDIN_ACTION_ENROLLMENT_MOVED_ERROR,
        },
        transactionManager,
      );
    },
  );

  it('preserves a started claim for real outcome reporting after its enrollment moved on', async () => {
    const { actionRepository, service } = setup({
      enrollmentStatus: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
      enrollmentWaitingOn: null,
      lockedAction: { ...action, executedAt },
    });

    await expect(
      service.release({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
      }),
    ).resolves.toBeNull();
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('never releases a started claim back to scheduled while its enrollment still waits', async () => {
    const { actionRepository, service } = setup({
      lockedAction: { ...action, executedAt },
    });

    await expect(
      service.release({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
      }),
    ).resolves.toBeNull();
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('returns null when a competing terminal update wins the final CAS', async () => {
    const { actionRepository, service } = setup({ updateAffected: 0 });

    await expect(
      service.release({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy,
        claimedAt,
      }),
    ).resolves.toBeNull();
    expect(actionRepository.update).toHaveBeenCalledTimes(1);
  });
});
