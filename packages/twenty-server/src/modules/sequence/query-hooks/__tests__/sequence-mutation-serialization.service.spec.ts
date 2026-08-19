import {
  LINKEDIN_ACTION_STATUSES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_WAITING_ON,
} from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { type SequenceLifecycleService } from 'src/modules/sequence/query-hooks/sequence-lifecycle.service';
import { SequenceMutationSerializationService } from 'src/modules/sequence/query-hooks/sequence-mutation-serialization.service';
import {
  SequenceDeleteOnePreQueryHook,
  SequenceRestoreOnePreQueryHook,
  SequenceUpdateOnePreQueryHook,
} from 'src/modules/sequence/query-hooks/sequence.query-hooks';
import { DEFAULT_SEQUENCE_SETTINGS } from 'src/modules/sequence/sequence.constants';
import { type SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

const createDeferred = <TValue = void>() => {
  let resolve: (value: TValue | PromiseLike<TValue>) => void = () => undefined;

  const promise = new Promise<TValue>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

type TestTransactionManager = WorkspaceEntityManager & {
  transactionId: symbol;
};

class SequenceRowMutex {
  private owner: symbol | undefined;
  private readonly waiters: Array<{
    owner: symbol;
    resolve: () => void;
  }> = [];
  private contention = createDeferred();

  async acquire(owner: symbol): Promise<void> {
    if (this.owner === undefined) {
      this.owner = owner;

      return;
    }

    if (this.owner === owner) return;

    this.contention.resolve();

    await new Promise<void>((resolve) => {
      this.waiters.push({ owner, resolve });
    });
  }

  release(owner: symbol): void {
    if (this.owner !== owner) return;

    const nextWaiter = this.waiters.shift();

    this.owner = nextWaiter?.owner;
    nextWaiter?.resolve();

    if (this.waiters.length === 0) {
      this.contention = createDeferred();
    }
  }

  async waitUntilContended(): Promise<void> {
    await this.contention.promise;
  }
}

describe('SequenceMutationSerializationService', () => {
  const authContext = {
    workspace: { id: 'workspace-id' },
  } as WorkspaceAuthContext;
  const sequenceId = 'sequence-id';
  const firstStep = {
    id: 'step-id',
    sequenceId,
    position: 0,
    settings: {
      type: SEQUENCE_STEP_TYPES.DELAY,
      days: 1,
      hours: 0,
      minutes: 0,
    },
  } as SequenceStepWorkspaceEntity;

  let activeDays: number[];
  let deletedAt: Date | null;
  let sequenceStatus: (typeof SEQUENCE_STATUSES)[keyof typeof SEQUENCE_STATUSES];
  let sequenceSteps: SequenceStepWorkspaceEntity[];
  let senderConnectedAccountId: string | null;
  let enrollment: SequenceEnrollmentWorkspaceEntity;
  let linkedinActionStatus:
    | (typeof LINKEDIN_ACTION_STATUSES)[keyof typeof LINKEDIN_ACTION_STATUSES]
    | null;
  let onUnlockedEnrollmentRead: (() => void) | undefined;
  let sequenceRowMutex: SequenceRowMutex;
  let invariantService: SequenceInvariantService;
  let service: SequenceMutationSerializationService;

  const runInTransaction = async <TResult>(
    callback: (manager: WorkspaceEntityManager) => Promise<TResult>,
  ): Promise<TResult> => {
    const manager = {
      transactionId: Symbol('test-transaction'),
    } as TestTransactionManager;

    try {
      return await callback(manager);
    } finally {
      sequenceRowMutex.release(manager.transactionId);
    }
  };

  beforeEach(() => {
    activeDays = [...DEFAULT_SEQUENCE_SETTINGS.activeDays];
    deletedAt = null;
    sequenceStatus = SEQUENCE_STATUSES.PAUSED;
    sequenceSteps = [firstStep];
    senderConnectedAccountId = 'old-sender-id';
    enrollment = {
      id: 'enrollment-id',
      sequenceId,
      personId: 'person-id',
      status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
      nextActionAt: null,
      lastSendAttempt: null,
      sentEmailsByStepId: {},
    } as SequenceEnrollmentWorkspaceEntity;
    linkedinActionStatus = null;
    onUnlockedEnrollmentRead = undefined;
    sequenceRowMutex = new SequenceRowMutex();

    const sequenceRepository = {
      find: jest.fn(
        async (
          _options: unknown,
          manager?: TestTransactionManager,
        ): Promise<SequenceWorkspaceEntity[]> => {
          if (manager) {
            await sequenceRowMutex.acquire(manager.transactionId);
          }

          return [
            {
              id: sequenceId,
              deletedAt,
              senderConnectedAccountId,
              settings: {
                ...DEFAULT_SEQUENCE_SETTINGS,
                activeDays,
              },
              status: sequenceStatus,
            } as SequenceWorkspaceEntity,
          ];
        },
      ),
    };
    const stepRepository = {
      find: jest.fn(async () => sequenceSteps),
      findOne: jest.fn(async () => firstStep),
    };
    const enrollmentRepository = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(async (options) => {
        if (!options.lock) {
          onUnlockedEnrollmentRead?.();
        }

        return { ...enrollment };
      }),
    };
    const linkedinActionRepository = {
      find: jest.fn(async () =>
        linkedinActionStatus === null
          ? []
          : [{ id: 'linkedin-action-id', status: linkedinActionStatus }],
      ),
      update: jest.fn(async (criteria, values) => {
        if (
          criteria.status !== LINKEDIN_ACTION_STATUSES.SCHEDULED ||
          linkedinActionStatus !== LINKEDIN_ACTION_STATUSES.SCHEDULED
        ) {
          return { affected: 0 };
        }

        linkedinActionStatus = values.status;

        return { affected: 1 };
      }),
    };
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback) => callback()),
      getRepository: jest.fn(async (_workspaceId, entity) => {
        if (entity === SequenceWorkspaceEntity) return sequenceRepository;
        if (entity === SequenceStepWorkspaceEntity) return stepRepository;
        if (
          entity === 'sequenceEnrollment' ||
          entity === SequenceEnrollmentWorkspaceEntity
        ) {
          return enrollmentRepository;
        }
        if (entity === LinkedinActionWorkspaceEntity) {
          return linkedinActionRepository;
        }

        throw new Error('Unexpected repository');
      }),
    } as unknown as GlobalWorkspaceOrmManager;
    invariantService = new SequenceInvariantService(globalWorkspaceOrmManager, {
      getReadySenderOrThrow: jest.fn(),
      getSenderAccountOrThrow: jest.fn(),
    } as unknown as SequenceSenderService);

    service = new SequenceMutationSerializationService(
      globalWorkspaceOrmManager,
      invariantService,
    );
  });

  it('rejects an empty-days settings write that loses to resume', async () => {
    const activationValidated = createDeferred();
    const allowActivationWrite = createDeferred();

    const activation = runInTransaction(async (workspaceEntityManager) => {
      await service.serializeSequenceUpdate({
        authContext,
        sequenceId,
        data: { status: SEQUENCE_STATUSES.ACTIVE },
        workspaceEntityManager,
      });
      activationValidated.resolve();
      await allowActivationWrite.promise;
      sequenceStatus = SEQUENCE_STATUSES.ACTIVE;
    });

    await activationValidated.promise;

    const settingsMutation = runInTransaction(
      async (workspaceEntityManager) => {
        await service.serializeSequenceUpdate({
          authContext,
          sequenceId,
          data: {
            settings: {
              ...DEFAULT_SEQUENCE_SETTINGS,
              activeDays: [],
            },
          },
          workspaceEntityManager,
        });
        activeDays = [];
      },
    );
    const settingsMutationAssertion = expect(settingsMutation).rejects.toThrow(
      'Pause the sequence before changing its settings',
    );

    await sequenceRowMutex.waitUntilContended();
    expect(sequenceStatus).toBe(SEQUENCE_STATUSES.PAUSED);
    expect(activeDays).toEqual(DEFAULT_SEQUENCE_SETTINGS.activeDays);

    allowActivationWrite.resolve();

    await activation;
    await settingsMutationAssertion;

    expect(sequenceStatus).toBe(SEQUENCE_STATUSES.ACTIVE);
    expect(activeDays).toEqual(DEFAULT_SEQUENCE_SETTINGS.activeDays);
  });

  it('returns normalized settings for the update query to persist', async () => {
    const updateHook = new SequenceUpdateOnePreQueryHook(
      service,
      {} as SequenceLifecycleService,
    );
    const payload = {
      id: sequenceId,
      data: {
        settings: {
          ...DEFAULT_SEQUENCE_SETTINGS,
          activeDays: 'not-an-array',
          windowStart: 'invalid-time',
          linkedinDelayPatternMinutes: 'not-an-array',
        },
      },
    } as never;

    const normalizedPayload = await runInTransaction((workspaceEntityManager) =>
      updateHook.executeInTransaction(
        authContext,
        'sequence',
        payload,
        workspaceEntityManager,
      ),
    );

    expect(normalizedPayload.data.settings).toEqual(
      expect.objectContaining({
        activeDays: DEFAULT_SEQUENCE_SETTINGS.activeDays,
        windowStart: DEFAULT_SEQUENCE_SETTINGS.windowStart,
        linkedinDelayPatternMinutes:
          DEFAULT_SEQUENCE_SETTINGS.linkedinDelayPatternMinutes,
      }),
    );
  });

  it('rejects a step create that starts after resume has the row lock', async () => {
    const activationValidated = createDeferred();
    const allowActivationWrite = createDeferred();

    const activation = runInTransaction(async (workspaceEntityManager) => {
      await service.serializeSequenceUpdate({
        authContext,
        sequenceId,
        data: { status: SEQUENCE_STATUSES.ACTIVE },
        workspaceEntityManager,
      });
      activationValidated.resolve();
      await allowActivationWrite.promise;
      sequenceStatus = SEQUENCE_STATUSES.ACTIVE;
    });

    await activationValidated.promise;

    const stepMutation = runInTransaction(async (workspaceEntityManager) => {
      await service.serializeStepCreates({
        authContext,
        sequenceIds: [sequenceId],
        workspaceEntityManager,
      });
      sequenceSteps = [
        ...sequenceSteps,
        { ...firstStep, id: 'second-step-id', position: 1 },
      ];
    });
    const stepMutationAssertion = expect(stepMutation).rejects.toThrow(
      'Pause the sequence before changing its steps',
    );

    await sequenceRowMutex.waitUntilContended();
    expect(sequenceSteps).toHaveLength(1);

    allowActivationWrite.resolve();

    await activation;
    await stepMutationAssertion;

    expect(sequenceStatus).toBe(SEQUENCE_STATUSES.ACTIVE);
    expect(sequenceSteps).toEqual([firstStep]);
  });

  it('normalizes a waiting enrollment from the committed sender configuration', async () => {
    const senderMutationValidated = createDeferred();
    const allowSenderWrite = createDeferred();

    const senderMutation = runInTransaction(async (workspaceEntityManager) => {
      await service.serializeSequenceUpdate({
        authContext,
        sequenceId,
        data: { senderConnectedAccountId: 'new-sender-id' },
        workspaceEntityManager,
      });
      senderMutationValidated.resolve();
      await allowSenderWrite.promise;
      senderConnectedAccountId = 'new-sender-id';
    });

    await senderMutationValidated.promise;

    const enrollmentCreate = runInTransaction((workspaceEntityManager) =>
      service.serializeEnrollmentCreates({
        authContext,
        data: [
          {
            sequenceId,
            personId: 'person-id',
          } as Partial<SequenceEnrollmentWorkspaceEntity>,
        ],
        workspaceEntityManager,
      }),
    );

    await sequenceRowMutex.waitUntilContended();
    allowSenderWrite.resolve();

    await senderMutation;
    const [normalizedEnrollment] = await enrollmentCreate;

    expect(normalizedEnrollment.senderConnectedAccountId).toBe('new-sender-id');
  });

  it('rejects skip after an email claim commits beyond its stale pre-read', async () => {
    sequenceStatus = SEQUENCE_STATUSES.ACTIVE;
    enrollment = {
      ...enrollment,
      waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      nextActionAt: new Date(0),
    };
    const claimLocked = createDeferred();
    const allowClaimCommit = createDeferred();
    const staleEnrollmentRead = createDeferred();

    const emailClaim = runInTransaction(async (workspaceEntityManager) => {
      const transactionManager =
        workspaceEntityManager as TestTransactionManager;

      await sequenceRowMutex.acquire(transactionManager.transactionId);
      claimLocked.resolve();
      await allowClaimCommit.promise;
      enrollment = {
        ...enrollment,
        lastSendAttempt: {
          stepId: 'email-step-id',
          attemptedAt: new Date().toISOString(),
        },
        nextActionAt: new Date(Date.now() + 60_000),
      };
    });

    await claimLocked.promise;
    onUnlockedEnrollmentRead = () => staleEnrollmentRead.resolve();

    const skip = runInTransaction((workspaceEntityManager) =>
      service.serializeEnrollmentUpdate({
        authContext,
        enrollmentId: enrollment.id,
        data: {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date(0),
        },
        workspaceEntityManager,
      }),
    );
    const skipAssertion = expect(skip).rejects.toThrow(
      'Wait for the in-flight sequence email to finish',
    );

    await staleEnrollmentRead.promise;
    await sequenceRowMutex.waitUntilContended();
    allowClaimCommit.resolve();

    await emailClaim;
    await skipAssertion;

    expect(enrollment.waitingOn).toBe(SEQUENCE_WAITING_ON.EMAIL_SCHEDULED);
    expect(enrollment.lastSendAttempt?.stepId).toBe('email-step-id');
  });

  it('rejects skip when a LinkedIn action wins the claim race', async () => {
    sequenceStatus = SEQUENCE_STATUSES.ACTIVE;
    enrollment = {
      ...enrollment,
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
    };
    linkedinActionStatus = LINKEDIN_ACTION_STATUSES.SCHEDULED;
    const claimLocked = createDeferred();
    const allowClaimCommit = createDeferred();
    const staleEnrollmentRead = createDeferred();

    const linkedinClaim = runInTransaction(async (workspaceEntityManager) => {
      const transactionManager =
        workspaceEntityManager as TestTransactionManager;

      await sequenceRowMutex.acquire(transactionManager.transactionId);
      claimLocked.resolve();
      await allowClaimCommit.promise;
      linkedinActionStatus = LINKEDIN_ACTION_STATUSES.CLAIMED;
    });

    await claimLocked.promise;
    onUnlockedEnrollmentRead = () => staleEnrollmentRead.resolve();

    const skip = runInTransaction((workspaceEntityManager) =>
      service.serializeEnrollmentUpdate({
        authContext,
        enrollmentId: enrollment.id,
        data: {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date(0),
        },
        workspaceEntityManager,
      }),
    );
    const skipAssertion = expect(skip).rejects.toThrow(
      'Wait for the in-flight LinkedIn action to finish',
    );

    await staleEnrollmentRead.promise;
    await sequenceRowMutex.waitUntilContended();
    allowClaimCommit.resolve();

    await linkedinClaim;
    await skipAssertion;

    expect(linkedinActionStatus).toBe(LINKEDIN_ACTION_STATUSES.CLAIMED);
    expect(enrollment.waitingOn).toBe(SEQUENCE_WAITING_ON.LINKEDIN_ACTION);
  });

  it('cancels a still-scheduled LinkedIn action before advancing', async () => {
    sequenceStatus = SEQUENCE_STATUSES.ACTIVE;
    enrollment = {
      ...enrollment,
      waitingOn: SEQUENCE_WAITING_ON.LINKEDIN_ACTION,
    };
    linkedinActionStatus = LINKEDIN_ACTION_STATUSES.SCHEDULED;

    const normalizedData = await runInTransaction((workspaceEntityManager) =>
      service.serializeEnrollmentUpdate({
        authContext,
        enrollmentId: enrollment.id,
        data: {
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
          nextActionAt: new Date(0),
        },
        workspaceEntityManager,
      }),
    );

    expect(linkedinActionStatus).toBe(LINKEDIN_ACTION_STATUSES.CANCELLED);
    expect(normalizedData.waitingOn).toBe(SEQUENCE_WAITING_ON.DELAY);
    expect(normalizedData.nextActionAt?.getTime()).toBeGreaterThan(0);
  });

  it('finishes pause quiescing before a waiting resume can commit', async () => {
    sequenceStatus = SEQUENCE_STATUSES.ACTIVE;

    const quiesceStarted = createDeferred();
    const allowQuiesce = createDeferred();
    let actionStatus: string = 'SCHEDULED';
    const lifecycleService = {
      quiesceOnPauseInTransaction: jest.fn(async () => {
        quiesceStarted.resolve();
        await allowQuiesce.promise;
        actionStatus = 'CANCELLED';
      }),
    } as unknown as SequenceLifecycleService;
    const updateHook = new SequenceUpdateOnePreQueryHook(
      service,
      lifecycleService,
    );
    const pausePayload = {
      id: sequenceId,
      data: { status: SEQUENCE_STATUSES.PAUSED },
    } as never;
    const resumePayload = {
      id: sequenceId,
      data: { status: SEQUENCE_STATUSES.ACTIVE },
    } as never;

    const pause = runInTransaction(async (workspaceEntityManager) => {
      await updateHook.executeInTransaction(
        authContext,
        'sequence',
        pausePayload,
        workspaceEntityManager,
      );
      sequenceStatus = SEQUENCE_STATUSES.PAUSED;
      await updateHook.executeAfterMutationInTransaction(
        authContext,
        'sequence',
        pausePayload,
        {} as never,
        workspaceEntityManager,
      );
    });

    await quiesceStarted.promise;

    const resume = runInTransaction(async (workspaceEntityManager) => {
      await updateHook.executeInTransaction(
        authContext,
        'sequence',
        resumePayload,
        workspaceEntityManager,
      );
      sequenceStatus = SEQUENCE_STATUSES.ACTIVE;
    });

    await sequenceRowMutex.waitUntilContended();
    expect(sequenceStatus).toBe(SEQUENCE_STATUSES.PAUSED);
    expect(actionStatus).toBe('SCHEDULED');

    allowQuiesce.resolve();

    await pause;
    await resume;

    expect(actionStatus).toBe('CANCELLED');
    expect(sequenceStatus).toBe(SEQUENCE_STATUSES.ACTIVE);
  });

  it('finishes archive finalization before a waiting restore can commit', async () => {
    let enrollmentStatus: string = 'ACTIVE';
    const finalizationStarted = createDeferred();
    const allowFinalization = createDeferred();
    const lifecycleService = {
      pauseBeforeArchiveInTransaction: jest.fn(),
      finalizeArchiveInTransaction: jest.fn(async () => {
        finalizationStarted.resolve();
        await allowFinalization.promise;

        if (deletedAt) {
          enrollmentStatus = 'REMOVED';
        }
      }),
    } as unknown as SequenceLifecycleService;
    const deleteHook = new SequenceDeleteOnePreQueryHook(
      invariantService,
      lifecycleService,
      service,
    );
    const restoreHook = new SequenceRestoreOnePreQueryHook(
      invariantService,
      service,
    );
    const mutationPayload = { id: sequenceId } as never;

    const archive = runInTransaction(async (workspaceEntityManager) => {
      await deleteHook.executeInTransaction(
        authContext,
        'sequence',
        mutationPayload,
        workspaceEntityManager,
      );
      deletedAt = new Date();
      await deleteHook.executeAfterMutationInTransaction(
        authContext,
        'sequence',
        mutationPayload,
        {} as never,
        workspaceEntityManager,
      );
    });

    await finalizationStarted.promise;

    const restore = runInTransaction(async (workspaceEntityManager) => {
      await restoreHook.executeInTransaction(
        authContext,
        'sequence',
        mutationPayload,
        workspaceEntityManager,
      );
      deletedAt = null;
    });

    await sequenceRowMutex.waitUntilContended();
    expect(deletedAt).toBeInstanceOf(Date);
    expect(enrollmentStatus).toBe('ACTIVE');

    allowFinalization.resolve();

    await archive;
    await restore;

    expect(deletedAt).toBeNull();
    expect(enrollmentStatus).toBe('REMOVED');
  });
});
