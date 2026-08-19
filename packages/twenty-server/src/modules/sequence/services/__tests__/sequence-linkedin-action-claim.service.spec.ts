import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { type SequenceEmailReplyReconciliationService } from 'src/modules/sequence/services/sequence-email-reply-reconciliation.service';
import { SequenceLinkedinActionClaimService } from 'src/modules/sequence/services/sequence-linkedin-action-claim.service';
import { type SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import {
  type SequenceSenderService,
  SequenceSenderUnavailableError,
} from 'src/modules/sequence/services/sequence-sender.service';
import {
  DEFAULT_SEQUENCE_SETTINGS,
  SEQUENCE_EXECUTION_ERROR,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

describe('SequenceLinkedinActionClaimService', () => {
  const workspaceId = 'workspace-id';
  const workspaceMemberId = 'workspace-member-id';
  const connectedAccountId = 'connected-account-id';
  const now = new Date('2026-08-17T12:00:00.000Z');
  const transactionManager = {} as WorkspaceEntityManager;
  const action = {
    id: 'action-id',
    type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
    status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
    scheduledAt: new Date('2026-08-17T11:58:00.000Z'),
    claimedAt: null,
    claimedBy: null,
    ownerWorkspaceMemberId: workspaceMemberId,
    sequenceEnrollmentId: 'enrollment-id',
    sequenceStepId: 'step-id',
    linkedinUrl: 'https://www.linkedin.com/in/example/',
    noteText: '',
  } as LinkedinActionWorkspaceEntity;

  const setup = ({
    enrollmentSenderConnectedAccountId = connectedAccountId,
    lockedEnrollmentSenderConnectedAccountId = enrollmentSenderConnectedAccountId,
    senderLockError,
    sequenceIsActive = true,
    sequenceSettings = DEFAULT_SEQUENCE_SETTINGS,
    sequenceSenderConnectedAccountId = connectedAccountId,
  }: {
    enrollmentSenderConnectedAccountId?: string | null;
    lockedEnrollmentSenderConnectedAccountId?: string | null;
    senderLockError?: Error;
    sequenceIsActive?: boolean;
    sequenceSettings?: typeof DEFAULT_SEQUENCE_SETTINGS;
    sequenceSenderConnectedAccountId?: string | null;
  } = {}) => {
    const lockTimeline: string[] = [];
    const actionRepository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          id: action.id,
          ownerWorkspaceMemberId: workspaceMemberId,
          sequenceEnrollmentId: action.sequenceEnrollmentId,
        })
        .mockResolvedValueOnce(action),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const enrollmentRepository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          id: action.sequenceEnrollmentId,
          senderConnectedAccountId: enrollmentSenderConnectedAccountId,
          sequenceId: 'sequence-id',
        })
        .mockResolvedValueOnce({
          id: action.sequenceEnrollmentId,
          currentStepId: action.sequenceStepId,
          senderConnectedAccountId: lockedEnrollmentSenderConnectedAccountId,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        }),
    };
    const sequenceRepository = {
      findOne: jest.fn().mockResolvedValue(
        sequenceIsActive
          ? {
              id: 'sequence-id',
              senderConnectedAccountId: sequenceSenderConnectedAccountId,
              status: SEQUENCE_STATUSES.ACTIVE,
              settings: sequenceSettings,
            }
          : null,
      ),
    };
    const repositories = new Map<object, object>([
      [LinkedinActionWorkspaceEntity, actionRepository],
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceWorkspaceEntity, sequenceRepository],
    ]);
    const transaction = jest.fn(async (callback) => {
      lockTimeline.push('workspace-transaction-started');
      const result = await callback(transactionManager);

      lockTimeline.push('workspace-transaction-committed');

      return result;
    });
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getGlobalWorkspaceDataSource: jest
        .fn()
        .mockResolvedValue({ transaction }),
      getRepository: jest.fn(async (_workspaceId, entity) =>
        repositories.get(entity),
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const reserveLinkedinSlot = jest
      .fn()
      .mockResolvedValue(new Date('2026-08-17T12:05:00.000Z'));
    const reserveClaimSlotIfTooEarly = jest.fn().mockResolvedValue(null);
    const reserveClaimSlotIfDailyCapExceeded = jest
      .fn()
      .mockResolvedValue(null);
    const sequenceLinkedinThrottleService = {
      reserveClaimSlotIfDailyCapExceeded,
      reserveClaimSlotIfTooEarly,
      reserveSlot: reserveLinkedinSlot,
    } as unknown as SequenceLinkedinThrottleService;
    const withLockedSenderAccountOrThrow = jest.fn(
      async ({ connectedAccountId: lockedConnectedAccountId, operation }) => {
        lockTimeline.push('sender-account-locked');

        if (senderLockError) {
          throw senderLockError;
        }

        const result = await operation({
          id: lockedConnectedAccountId,
        } as ConnectedAccountEntity);

        lockTimeline.push('sender-account-lock-released');

        return result;
      },
    );
    const sequenceSenderService = {
      withLockedSenderAccountOrThrow,
    } as unknown as SequenceSenderService;
    const reconcileBeforeEnrollmentProgress = jest
      .fn()
      .mockResolvedValue(false);
    const sequenceEmailReplyReconciliationService = {
      reconcileBeforeEnrollmentProgress,
    } as unknown as SequenceEmailReplyReconciliationService;
    const reconcileEnrollmentBeforeProviderStart = jest
      .fn()
      .mockResolvedValue(false);
    const sequenceLinkedinReplyListener = {
      reconcileEnrollmentBeforeProviderStart,
    } as unknown as SequenceLinkedinReplyListener;
    const service = new SequenceLinkedinActionClaimService(
      globalWorkspaceOrmManager,
      sequenceEmailReplyReconciliationService,
      sequenceLinkedinReplyListener,
      sequenceLinkedinThrottleService,
      sequenceSenderService,
    );

    return {
      service,
      actionRepository,
      enrollmentRepository,
      lockTimeline,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      reserveClaimSlotIfDailyCapExceeded,
      reserveClaimSlotIfTooEarly,
      reserveLinkedinSlot,
      sequenceRepository,
      transaction,
      withLockedSenderAccountOrThrow,
    };
  };

  it('claims under sequence, enrollment, then action locks when the sequence is active', async () => {
    const {
      service,
      actionRepository,
      enrollmentRepository,
      lockTimeline,
      reserveClaimSlotIfTooEarly,
      reserveLinkedinSlot,
      sequenceRepository,
      withLockedSenderAccountOrThrow,
    } = setup();

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toEqual({
      id: action.id,
      type: action.type,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
      scheduledAt: action.scheduledAt,
      claimedAt: now,
      claimedBy: 'extension-tab-42',
      executedAt: null,
      linkedinUrl: action.linkedinUrl,
      noteText: action.noteText,
    });

    expect(sequenceRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'sequence-id',
          status: SEQUENCE_STATUSES.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(enrollmentRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'enrollment-id',
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
        }),
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(actionRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: action.id,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
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
      expect.objectContaining({
        id: action.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      }),
      {
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        claimedAt: now,
        claimedBy: 'extension-tab-42',
      },
      transactionManager,
    );
    expect(withLockedSenderAccountOrThrow).toHaveBeenCalledWith({
      connectedAccountId,
      operation: expect.any(Function),
      workspaceId,
    });
    expect(lockTimeline).toEqual([
      'sender-account-locked',
      'workspace-transaction-started',
      'workspace-transaction-committed',
      'sender-account-lock-released',
    ]);
    expect(reserveClaimSlotIfTooEarly).toHaveBeenCalledWith({
      actionId: action.id,
      actionScheduledAt: action.scheduledAt,
      now,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: DEFAULT_SEQUENCE_SETTINGS,
      transactionManager,
      workspaceId,
    });
    expect(actionRepository.findOne.mock.invocationCallOrder[1]).toBeLessThan(
      reserveClaimSlotIfTooEarly.mock.invocationCallOrder[0],
    );
    expect(reserveClaimSlotIfTooEarly.mock.invocationCallOrder[0]).toBeLessThan(
      actionRepository.update.mock.invocationCallOrder[0],
    );
    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
  });

  it('reconciles a lost email reply before claiming a scheduled LinkedIn action', async () => {
    const {
      service,
      actionRepository,
      enrollmentRepository,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      withLockedSenderAccountOrThrow,
    } = setup();
    const enrollmentCandidate = {
      id: 'enrollment-id',
      personId: 'person-id',
      senderConnectedAccountId: connectedAccountId,
      sentEmailsByStepId: {
        'email-step-id': {
          headerMessageId: 'email-header-message-id',
          threadExternalId: 'email-thread-id',
          sentAt: '2026-08-17T10:00:00.000Z',
          connectedAccountId,
        },
      },
      sequenceId: 'sequence-id',
    };

    enrollmentRepository.findOne
      .mockReset()
      .mockResolvedValueOnce(enrollmentCandidate);
    reconcileBeforeEnrollmentProgress.mockResolvedValueOnce(true);

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();

    expect(reconcileBeforeEnrollmentProgress).toHaveBeenCalledWith({
      workspaceId,
      enrollment: enrollmentCandidate,
      enrollmentRepository,
    });
    expect(reconcileEnrollmentBeforeProviderStart).not.toHaveBeenCalled();
    expect(withLockedSenderAccountOrThrow).not.toHaveBeenCalled();
    expect(actionRepository.findOne).toHaveBeenCalledTimes(1);
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('re-slots a linked action when a direct action already consumed the same-day cap', async () => {
    const {
      actionRepository,
      reserveClaimSlotIfDailyCapExceeded,
      reserveClaimSlotIfTooEarly,
      service,
    } = setup({
      sequenceSettings: {
        ...DEFAULT_SEQUENCE_SETTINGS,
        linkedinDailyActionLimitEnabled: true,
        linkedinDailyActions: 1,
      },
    });
    const cappedSettings = {
      ...DEFAULT_SEQUENCE_SETTINGS,
      linkedinDailyActionLimitEnabled: true,
      linkedinDailyActions: 1,
    };
    const replacementScheduledAt = new Date('2026-08-18T09:00:00.000Z');

    reserveClaimSlotIfDailyCapExceeded.mockResolvedValueOnce(
      replacementScheduledAt,
    );

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();

    expect(reserveClaimSlotIfDailyCapExceeded).toHaveBeenCalledWith({
      actionId: action.id,
      actionScheduledAt: action.scheduledAt,
      now,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: cappedSettings,
      transactionManager,
      workspaceId,
    });
    expect(reserveClaimSlotIfTooEarly).not.toHaveBeenCalled();
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: action.id,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      }),
      { scheduledAt: replacementScheduledAt },
      transactionManager,
    );
  });

  it('reconciles a lost LinkedIn reply before claiming a scheduled action', async () => {
    const {
      service,
      actionRepository,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      withLockedSenderAccountOrThrow,
    } = setup();

    reconcileEnrollmentBeforeProviderStart.mockResolvedValueOnce(true);

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();

    expect(reconcileBeforeEnrollmentProgress).toHaveBeenCalled();
    expect(reconcileEnrollmentBeforeProviderStart).toHaveBeenCalledWith({
      sequenceEnrollmentId: action.sequenceEnrollmentId,
      workspaceId,
    });
    expect(withLockedSenderAccountOrThrow).not.toHaveBeenCalled();
    expect(actionRepository.findOne).toHaveBeenCalledTimes(1);
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('re-slots a materially overdue same-day action before claiming it', async () => {
    const staleAction = {
      ...action,
      scheduledAt: new Date('2026-08-17T09:00:00.000Z'),
    } as LinkedinActionWorkspaceEntity;
    const freshSlot = new Date('2026-08-17T17:05:00.000Z');
    const {
      service,
      actionRepository,
      reserveClaimSlotIfTooEarly,
      reserveLinkedinSlot,
      sequenceRepository,
    } = setup();

    actionRepository.findOne
      .mockReset()
      .mockResolvedValueOnce({
        id: staleAction.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: staleAction.sequenceEnrollmentId,
      })
      .mockResolvedValueOnce(staleAction);
    sequenceRepository.findOne.mockResolvedValue({
      id: 'sequence-id',
      status: SEQUENCE_STATUSES.ACTIVE,
      settings: {
        ...DEFAULT_SEQUENCE_SETTINGS,
        linkedinDailyActionLimitEnabled: true,
        linkedinDailyActions: 1,
        linkedinDelayPatternMinutes: [5],
      },
    });
    reserveLinkedinSlot.mockResolvedValue(freshSlot);

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: staleAction.id,
        claimedBy: 'extension-tab-42',
        now: new Date('2026-08-17T17:00:00.000Z'),
      }),
    ).resolves.toBeNull();

    expect(reserveLinkedinSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        ownerWorkspaceMemberId: workspaceMemberId,
        settings: expect.objectContaining({
          linkedinDelayPatternMinutes: [5],
        }),
        excludedActionId: staleAction.id,
      }),
    );
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: staleAction.id }),
      { scheduledAt: freshSlot },
      transactionManager,
    );
    expect(actionRepository.findOne.mock.invocationCallOrder[1]).toBeLessThan(
      reserveLinkedinSlot.mock.invocationCallOrder[0],
    );
    expect(reserveClaimSlotIfTooEarly).not.toHaveBeenCalled();
  });

  it('claims a freshly re-slotted action within the polling grace', async () => {
    const freshAction = {
      ...action,
      scheduledAt: new Date('2026-08-17T11:58:30.000Z'),
    } as LinkedinActionWorkspaceEntity;
    const {
      service,
      actionRepository,
      reserveClaimSlotIfTooEarly,
      reserveLinkedinSlot,
      sequenceRepository,
    } = setup();

    actionRepository.findOne
      .mockReset()
      .mockResolvedValueOnce({
        id: freshAction.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: freshAction.sequenceEnrollmentId,
      })
      .mockResolvedValueOnce(freshAction);
    sequenceRepository.findOne.mockResolvedValue({
      id: 'sequence-id',
      status: SEQUENCE_STATUSES.ACTIVE,
      settings: {
        ...DEFAULT_SEQUENCE_SETTINGS,
        linkedinDelayPatternMinutes: [1],
      },
    });

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: freshAction.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: freshAction.id,
        claimedAt: now,
      }),
    );

    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
    expect(reserveClaimSlotIfTooEarly).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: freshAction.id,
        actionScheduledAt: freshAction.scheduledAt,
      }),
    );
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: freshAction.id }),
      expect.objectContaining({ status: LINKEDIN_ACTION_STATUSES.CLAIMED }),
      transactionManager,
    );
  });

  it('re-reserves a fresh action when actual claims would compress its intended gap', async () => {
    const actualPacingSlot = new Date('2026-08-17T12:06:59.000Z');
    const {
      service,
      actionRepository,
      reserveClaimSlotIfTooEarly,
      reserveLinkedinSlot,
    } = setup();

    reserveClaimSlotIfTooEarly.mockResolvedValue(actualPacingSlot);

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();

    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: action.id,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      }),
      { scheduledAt: actualPacingSlot },
      transactionManager,
    );
    expect(actionRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: LINKEDIN_ACTION_STATUSES.CLAIMED }),
      expect.anything(),
    );
    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
  });

  it('preserves persisted pacing when consecutive actions are both within the polling grace', async () => {
    const firstAction = {
      ...action,
      id: 'first-action-id',
      scheduledAt: new Date('2026-08-17T09:00:00.000Z'),
      sequenceEnrollmentId: 'first-enrollment-id',
      sequenceStepId: 'first-step-id',
    } as LinkedinActionWorkspaceEntity;
    const secondAction = {
      ...action,
      id: 'second-action-id',
      scheduledAt: new Date('2026-08-17T09:05:00.000Z'),
      sequenceEnrollmentId: 'second-enrollment-id',
      sequenceStepId: 'second-step-id',
    } as LinkedinActionWorkspaceEntity;
    const firstClaimedAt = new Date('2026-08-17T09:01:30.000Z');
    const secondClaimedAt = new Date('2026-08-17T09:06:30.000Z');
    const {
      service,
      actionRepository,
      enrollmentRepository,
      reserveLinkedinSlot,
    } = setup();

    actionRepository.findOne
      .mockReset()
      .mockResolvedValueOnce({
        id: firstAction.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: firstAction.sequenceEnrollmentId,
      })
      .mockResolvedValueOnce(firstAction)
      .mockResolvedValueOnce({
        id: secondAction.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: secondAction.sequenceEnrollmentId,
      })
      .mockResolvedValueOnce(secondAction);
    enrollmentRepository.findOne
      .mockReset()
      .mockResolvedValueOnce({
        id: firstAction.sequenceEnrollmentId,
        sequenceId: 'sequence-id',
      })
      .mockResolvedValueOnce({
        id: firstAction.sequenceEnrollmentId,
        currentStepId: firstAction.sequenceStepId,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      })
      .mockResolvedValueOnce({
        id: secondAction.sequenceEnrollmentId,
        sequenceId: 'sequence-id',
      })
      .mockResolvedValueOnce({
        id: secondAction.sequenceEnrollmentId,
        currentStepId: secondAction.sequenceStepId,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
        waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
      });

    const firstClaim = await service.claim({
      workspaceId,
      workspaceMemberId,
      actionId: firstAction.id,
      claimedBy: 'extension-tab-42',
      now: firstClaimedAt,
    });
    const secondClaim = await service.claim({
      workspaceId,
      workspaceMemberId,
      actionId: secondAction.id,
      claimedBy: 'extension-tab-42',
      now: secondClaimedAt,
    });

    expect([firstClaim?.claimedAt, secondClaim?.claimedAt]).toEqual([
      firstClaimedAt,
      secondClaimedAt,
    ]);
    expect(secondClaimedAt.getTime() - firstClaimedAt.getTime()).toBe(
      5 * 60 * 1000,
    );
    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
  });

  it('re-slots a four-minute-old action regardless of a long configured delay', async () => {
    const staleAction = {
      ...action,
      scheduledAt: new Date('2026-08-17T11:56:00.000Z'),
    } as LinkedinActionWorkspaceEntity;
    const freshSlot = new Date('2026-08-17T15:00:00.000Z');
    const {
      service,
      actionRepository,
      reserveClaimSlotIfTooEarly,
      reserveLinkedinSlot,
      sequenceRepository,
    } = setup();

    actionRepository.findOne
      .mockReset()
      .mockResolvedValueOnce({
        id: staleAction.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: staleAction.sequenceEnrollmentId,
      })
      .mockResolvedValueOnce(staleAction);
    sequenceRepository.findOne.mockResolvedValue({
      id: 'sequence-id',
      status: SEQUENCE_STATUSES.ACTIVE,
      settings: {
        ...DEFAULT_SEQUENCE_SETTINGS,
        linkedinDelayPatternMinutes: [180],
      },
    });
    reserveLinkedinSlot.mockResolvedValue(freshSlot);

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: staleAction.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();

    expect(reserveLinkedinSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          linkedinDelayPatternMinutes: [180],
        }),
        now,
        excludedActionId: staleAction.id,
      }),
    );
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: staleAction.id }),
      { scheduledAt: freshSlot },
      transactionManager,
    );
    expect(actionRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: LINKEDIN_ACTION_STATUSES.CLAIMED }),
      expect.anything(),
    );
    expect(reserveClaimSlotIfTooEarly).not.toHaveBeenCalled();
  });

  it('re-slots an offline backlog action through the current UTC-day budget', async () => {
    const staleAction = {
      ...action,
      scheduledAt: new Date('2026-08-16T23:55:00.000Z'),
    } as LinkedinActionWorkspaceEntity;
    const rolledSlot = new Date('2026-08-18T09:00:00.000Z');
    const {
      service,
      actionRepository,
      reserveClaimSlotIfTooEarly,
      reserveLinkedinSlot,
      sequenceRepository,
    } = setup();

    actionRepository.findOne
      .mockReset()
      .mockResolvedValueOnce({
        id: staleAction.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: staleAction.sequenceEnrollmentId,
      })
      .mockResolvedValueOnce(staleAction);
    sequenceRepository.findOne.mockResolvedValue({
      id: 'sequence-id',
      status: SEQUENCE_STATUSES.ACTIVE,
      settings: {
        ...DEFAULT_SEQUENCE_SETTINGS,
        linkedinDailyActionLimitEnabled: true,
        linkedinDailyActions: 1,
      },
    });
    reserveLinkedinSlot.mockResolvedValue(rolledSlot);

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: staleAction.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();

    expect(reserveLinkedinSlot).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: expect.objectContaining({
        linkedinDailyActionLimitEnabled: true,
        linkedinDailyActions: 1,
      }),
      now,
      transactionManager,
      excludedActionId: staleAction.id,
    });
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: staleAction.id,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      }),
      { scheduledAt: rolledSlot },
      transactionManager,
    );
    expect(actionRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: LINKEDIN_ACTION_STATUSES.CLAIMED }),
      expect.anything(),
    );
    expect(reserveClaimSlotIfTooEarly).not.toHaveBeenCalled();
  });

  it('re-slots a stale unlinked action under the account budget so later work can progress', async () => {
    const staleUnlinkedAction = {
      ...action,
      id: 'stale-unlinked-action-id',
      scheduledAt: new Date('2026-08-16T23:55:00.000Z'),
      sequenceEnrollmentId: null,
      sequenceStepId: null,
    } as LinkedinActionWorkspaceEntity;
    const nextUnlinkedAction = {
      ...action,
      id: 'next-unlinked-action-id',
      scheduledAt: new Date('2026-08-17T11:59:00.000Z'),
      sequenceEnrollmentId: null,
      sequenceStepId: null,
    } as LinkedinActionWorkspaceEntity;
    const { service, actionRepository, reserveLinkedinSlot } = setup();

    actionRepository.findOne
      .mockReset()
      .mockResolvedValueOnce({
        id: staleUnlinkedAction.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: null,
      })
      .mockResolvedValueOnce(staleUnlinkedAction)
      .mockResolvedValueOnce({
        id: nextUnlinkedAction.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: null,
      })
      .mockResolvedValueOnce(nextUnlinkedAction);

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: staleUnlinkedAction.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();
    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: nextUnlinkedAction.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: nextUnlinkedAction.id,
        claimedAt: now,
      }),
    );

    expect(actionRepository.findOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      transactionManager,
    );
    expect(reserveLinkedinSlot).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId: workspaceMemberId,
      settings: expect.objectContaining({
        linkedinDailyActionLimitEnabled: true,
        linkedinDailyActions: 20,
      }),
      now,
      transactionManager,
      excludedActionId: staleUnlinkedAction.id,
    });
    expect(actionRepository.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: staleUnlinkedAction.id,
        ownerWorkspaceMemberId: workspaceMemberId,
        sequenceEnrollmentId: expect.anything(),
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
      }),
      {
        scheduledAt: new Date('2026-08-17T12:05:00.000Z'),
      },
      transactionManager,
    );
    expect(actionRepository.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: nextUnlinkedAction.id }),
      {
        status: LINKEDIN_ACTION_STATUSES.CLAIMED,
        claimedAt: now,
        claimedBy: 'extension-tab-42',
      },
      transactionManager,
    );
    expect(actionRepository.findOne.mock.invocationCallOrder[1]).toBeLessThan(
      actionRepository.update.mock.invocationCallOrder[0],
    );
  });

  it.each([
    {
      reason: 'daily cap',
      configure: ({
        reserveClaimSlotIfDailyCapExceeded,
      }: {
        reserveClaimSlotIfDailyCapExceeded: jest.Mock;
        reserveClaimSlotIfTooEarly: jest.Mock;
      }) =>
        reserveClaimSlotIfDailyCapExceeded.mockResolvedValueOnce(
          new Date('2026-08-18T00:01:00.000Z'),
        ),
      expectedSlot: new Date('2026-08-18T00:01:00.000Z'),
    },
    {
      reason: 'actual account pacing',
      configure: ({
        reserveClaimSlotIfTooEarly,
      }: {
        reserveClaimSlotIfDailyCapExceeded: jest.Mock;
        reserveClaimSlotIfTooEarly: jest.Mock;
      }) =>
        reserveClaimSlotIfTooEarly.mockResolvedValueOnce(
          new Date('2026-08-17T12:04:00.000Z'),
        ),
      expectedSlot: new Date('2026-08-17T12:04:00.000Z'),
    },
  ])(
    're-slots a due unlinked action when the $reason rejects its claim',
    async ({ configure, expectedSlot }) => {
      const unlinkedAction = {
        ...action,
        id: 'unlinked-action-id',
        sequenceEnrollmentId: null,
        sequenceStepId: null,
      } as LinkedinActionWorkspaceEntity;
      const {
        service,
        actionRepository,
        reserveClaimSlotIfDailyCapExceeded,
        reserveClaimSlotIfTooEarly,
      } = setup();

      actionRepository.findOne
        .mockReset()
        .mockResolvedValueOnce({
          id: unlinkedAction.id,
          ownerWorkspaceMemberId: workspaceMemberId,
          sequenceEnrollmentId: null,
        })
        .mockResolvedValueOnce(unlinkedAction);
      configure({
        reserveClaimSlotIfDailyCapExceeded,
        reserveClaimSlotIfTooEarly,
      });

      await expect(
        service.claim({
          workspaceId,
          workspaceMemberId,
          actionId: unlinkedAction.id,
          claimedBy: 'extension-tab-42',
          now,
        }),
      ).resolves.toBeNull();

      expect(actionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: unlinkedAction.id,
          sequenceEnrollmentId: expect.anything(),
          sequenceStepId: expect.anything(),
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        }),
        { scheduledAt: expectedSlot },
        transactionManager,
      );
      expect(actionRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: LINKEDIN_ACTION_STATUSES.CLAIMED }),
        expect.anything(),
      );
    },
  );

  it('locks and validates the sequence fallback sender before claiming', async () => {
    const {
      service,
      actionRepository,
      sequenceRepository,
      withLockedSenderAccountOrThrow,
    } = setup({ enrollmentSenderConnectedAccountId: null });

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: action.id }));

    expect(sequenceRepository.findOne).toHaveBeenNthCalledWith(1, {
      where: { id: 'sequence-id' },
      select: ['id', 'senderConnectedAccountId'],
    });
    expect(withLockedSenderAccountOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId }),
    );
    expect(actionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: action.id }),
      expect.objectContaining({ status: LINKEDIN_ACTION_STATUSES.CLAIMED }),
      transactionManager,
    );
  });

  it('retries instead of claiming under a stale pre-read sender lock', async () => {
    const replacementConnectedAccountId = 'replacement-connected-account-id';
    const { service, actionRepository, transaction } = setup({
      lockedEnrollmentSenderConnectedAccountId: replacementConnectedAccountId,
    });

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(actionRepository.findOne).toHaveBeenCalledTimes(1);
    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      scenario: 'archived',
      errorMessage:
        'Choose an active sender account that belongs to your workspace account',
    },
    {
      scenario: 'unsupported',
      errorMessage: 'The selected account cannot be used as a sequence sender',
    },
  ])(
    'fails the scheduled action when its sender becomes $scenario before claim',
    async ({ errorMessage }) => {
      const {
        service,
        actionRepository,
        transaction,
        withLockedSenderAccountOrThrow,
      } = setup({
        senderLockError: new SequenceSenderUnavailableError(errorMessage),
      });

      await expect(
        service.claim({
          workspaceId,
          workspaceMemberId,
          actionId: action.id,
          claimedBy: 'extension-tab-42',
          now,
        }),
      ).resolves.toBeNull();

      expect(withLockedSenderAccountOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ connectedAccountId }),
      );
      expect(transaction).not.toHaveBeenCalled();
      expect(actionRepository.update).toHaveBeenCalledWith(
        {
          id: action.id,
          ownerWorkspaceMemberId: workspaceMemberId,
          sequenceEnrollmentId: action.sequenceEnrollmentId,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        },
        {
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          claimedAt: null,
          claimedBy: null,
          executedAt: null,
          errorMessage: SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
        },
      );
    },
  );

  it('leaves the action scheduled when sender validation has a database outage', async () => {
    const databaseError = new Error('database unavailable');
    const { service, actionRepository } = setup({
      senderLockError: databaseError,
    });

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).rejects.toBe(databaseError);

    expect(actionRepository.update).not.toHaveBeenCalled();
  });

  it('rejects the claim while the parent sequence is paused', async () => {
    const {
      service,
      actionRepository,
      enrollmentRepository,
      reserveLinkedinSlot,
    } = setup({ sequenceIsActive: false });

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();

    expect(enrollmentRepository.findOne).toHaveBeenCalledTimes(1);
    expect(actionRepository.findOne).toHaveBeenCalledTimes(1);
    expect(actionRepository.update).not.toHaveBeenCalled();
    expect(reserveLinkedinSlot).not.toHaveBeenCalled();
  });

  it('does not expose or claim another workspace member action', async () => {
    const { service, actionRepository } = setup();

    actionRepository.findOne.mockReset().mockResolvedValue(null);

    await expect(
      service.claim({
        workspaceId,
        workspaceMemberId,
        actionId: action.id,
        claimedBy: 'extension-tab-42',
        now,
      }),
    ).resolves.toBeNull();

    expect(actionRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: action.id,
          ownerWorkspaceMemberId: workspaceMemberId,
        },
      }),
    );
    expect(actionRepository.update).not.toHaveBeenCalled();
  });
});
