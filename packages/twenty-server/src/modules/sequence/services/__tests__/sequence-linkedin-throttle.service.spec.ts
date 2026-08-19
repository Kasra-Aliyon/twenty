import {
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_ACTION_STATUSES,
  type SequenceSettings,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type FindOperator } from 'typeorm';

import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import {
  DEFAULT_SEQUENCE_SETTINGS,
  SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX,
  SEQUENCE_EXECUTION_ERROR,
} from 'src/modules/sequence/sequence.constants';
import { isWithinSendingWindow } from 'src/modules/sequence/utils/sequence-window.util';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

describe('SequenceLinkedinThrottleService', () => {
  const workspaceId = 'workspace-id';
  const ownerWorkspaceMemberId = 'owner-workspace-member-id';

  const buildService = ({
    isTransactionActive = true,
  }: { isTransactionActive?: boolean } = {}) => {
    const values = new Map<string, unknown>();
    const cacheStorageService = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn(),
      get: jest.fn(async (key: string) => values.get(key)),
      set: jest.fn(
        async (key: string, value: unknown) => void values.set(key, value),
      ),
    } as unknown as CacheStorageService;
    const workspaceMemberRepository = {
      findOne: jest
        .fn()
        .mockImplementation(async ({ where }) => ({ id: where.id })),
    };
    type MockLinkedinAction = Pick<
      LinkedinActionWorkspaceEntity,
      | 'claimedAt'
      | 'deletedAt'
      | 'errorMessage'
      | 'executedAt'
      | 'id'
      | 'ownerWorkspaceMemberId'
      | 'scheduledAt'
      | 'status'
      | 'type'
    >;
    type MockFindOneOptions = {
      where?: {
        id?: string | FindOperator<string>;
        claimedAt?: Date | FindOperator<Date>;
        executedAt?: Date | FindOperator<Date>;
        ownerWorkspaceMemberId?: string;
        scheduledAt?: Date | FindOperator<Date>;
        status?: string | FindOperator<string[]>;
      };
      order?: {
        claimedAt?: 'ASC' | 'DESC';
        executedAt?: 'ASC' | 'DESC';
        scheduledAt?: 'ASC' | 'DESC';
      };
      withDeleted?: boolean;
    };
    const persistedActions: MockLinkedinAction[] = [];
    const linkedinActionRepository = {
      findOne: jest
        .fn()
        .mockImplementation(
          async (
            options: MockFindOneOptions,
          ): Promise<MockLinkedinAction | null> => {
            const scheduledAtCondition = options.where?.scheduledAt;
            const claimedAtCondition = options.where?.claimedAt;
            const executedAtCondition = options.where?.executedAt;
            const statusCondition = options.where?.status;
            const idCondition = options.where?.id;
            const queryOwnerWorkspaceMemberId =
              options.where?.ownerWorkspaceMemberId;
            let matches = persistedActions.filter(
              (action) =>
                !isDefined(queryOwnerWorkspaceMemberId) ||
                action.ownerWorkspaceMemberId === queryOwnerWorkspaceMemberId,
            );

            if (options.withDeleted !== true) {
              matches = matches.filter(
                (action) => !isDefined(action.deletedAt),
              );
            }

            if (isDefined(idCondition) && typeof idCondition !== 'string') {
              matches = matches.filter(
                (action) =>
                  idCondition.type !== 'not' || action.id !== idCondition.value,
              );
            }

            if (scheduledAtCondition instanceof Date) {
              matches = matches.filter(
                (action) =>
                  action.scheduledAt.getTime() ===
                  scheduledAtCondition.getTime(),
              );
            } else if (isDefined(scheduledAtCondition)) {
              const conditionTimestamp = scheduledAtCondition.value.getTime();

              matches = matches.filter((action) => {
                if (scheduledAtCondition.type === 'lessThan') {
                  return action.scheduledAt.getTime() < conditionTimestamp;
                }

                if (scheduledAtCondition.type === 'lessThanOrEqual') {
                  return action.scheduledAt.getTime() <= conditionTimestamp;
                }

                return action.scheduledAt.getTime() >= conditionTimestamp;
              });
            }

            if (
              isDefined(statusCondition) &&
              typeof statusCondition !== 'string'
            ) {
              matches = matches.filter((action) =>
                statusCondition.value.includes(action.status),
              );
            }

            if (isDefined(claimedAtCondition)) {
              matches = matches.filter((action) => {
                if (claimedAtCondition instanceof Date) {
                  return (
                    action.claimedAt?.getTime() === claimedAtCondition.getTime()
                  );
                }

                if (claimedAtCondition.type === 'not') {
                  return isDefined(action.claimedAt);
                }

                return true;
              });
            }

            if (isDefined(executedAtCondition)) {
              matches = matches.filter((action) => {
                if (executedAtCondition instanceof Date) {
                  return (
                    action.executedAt?.getTime() ===
                    executedAtCondition.getTime()
                  );
                }

                if (executedAtCondition.type === 'not') {
                  return isDefined(action.executedAt);
                }

                return true;
              });
            }

            matches.sort((firstAction, secondAction) => {
              const difference = isDefined(options.order?.claimedAt)
                ? (firstAction.claimedAt?.getTime() ?? 0) -
                  (secondAction.claimedAt?.getTime() ?? 0)
                : isDefined(options.order?.executedAt)
                  ? (firstAction.executedAt?.getTime() ?? 0) -
                    (secondAction.executedAt?.getTime() ?? 0)
                  : firstAction.scheduledAt.getTime() -
                    secondAction.scheduledAt.getTime();

              return options.order?.scheduledAt === 'DESC' ||
                options.order?.claimedAt === 'DESC' ||
                options.order?.executedAt === 'DESC'
                ? -difference
                : difference;
            });

            return matches[0] ?? null;
          },
        ),
      count: jest.fn().mockResolvedValue(0),
    };
    const persistAction = (
      scheduledAt: Date,
      overrides: Partial<MockLinkedinAction> = {},
    ) => {
      persistedActions.push({
        id: `persisted-action-${persistedActions.length}`,
        claimedAt: null,
        deletedAt: null,
        errorMessage: null,
        executedAt: null,
        ownerWorkspaceMemberId,
        scheduledAt,
        status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
        ...overrides,
      });
    };
    const transactionManager = {
      queryRunner: { isTransactionActive },
      getRepository: jest.fn((entity) => {
        if (entity === WorkspaceMemberWorkspaceEntity) {
          return workspaceMemberRepository;
        }

        if (entity === LinkedinActionWorkspaceEntity) {
          return linkedinActionRepository;
        }

        throw new Error('Unexpected repository');
      }),
    } as unknown as WorkspaceEntityManager;

    return {
      service: new SequenceLinkedinThrottleService(cacheStorageService),
      cacheStorageService,
      linkedinActionRepository,
      persistAction,
      persistedActions,
      transactionManager,
      values,
      workspaceMemberRepository,
    };
  };

  const buildSettings = (
    overrides: Partial<SequenceSettings> = {},
  ): SequenceSettings => ({
    ...DEFAULT_SEQUENCE_SETTINGS,
    timezone: 'UTC',
    activeDays: [1, 2, 3, 4, 5],
    windowStart: '09:00',
    windowEnd: '17:00',
    linkedinDailyActionLimitEnabled: true,
    ...overrides,
  });

  const gapsInMinutes = (slots: Date[], now: Date): number[] =>
    slots.map((slot, index) =>
      index === 0
        ? (slot.getTime() - now.getTime()) / 60_000
        : (slot.getTime() - slots[index - 1].getTime()) / 60_000,
    );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps consecutive delays when only the daily cap is disabled', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { persistAction, service, transactionManager, values } =
      buildService();
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActionLimitEnabled: false,
      linkedinDailyActions: 1,
      linkedinDelayPatternMinutes: [15],
    });

    const firstSlot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now,
      transactionManager,
    });

    persistAction(firstSlot);

    const secondSlot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now,
      transactionManager,
    });

    expect(firstSlot.toISOString()).toBe('2026-07-20T09:15:00.000Z');
    expect(secondSlot.toISOString()).toBe('2026-07-20T09:30:00.000Z');
    expect([...values.keys()].some((key) => key.includes('daily-count'))).toBe(
      false,
    );
  });

  it('preserves a five-minute actual claim gap when the first action is claimed just inside grace', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const {
      linkedinActionRepository,
      persistAction,
      service,
      transactionManager,
      workspaceMemberRepository,
    } = buildService();
    const firstScheduledAt = new Date('2026-07-20T09:00:00.000Z');
    const secondScheduledAt = new Date('2026-07-20T09:05:00.000Z');
    const firstClaimedAt = new Date('2026-07-20T09:01:59.000Z');

    persistAction(firstScheduledAt, {
      claimedAt: firstClaimedAt,
      deletedAt: '2026-07-20T09:02:30.000Z',
      id: 'first-action-id',
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
    });
    persistAction(secondScheduledAt, { id: 'second-action-id' });

    const replacementSlot = await service.reserveClaimSlotIfTooEarly({
      actionId: 'second-action-id',
      actionScheduledAt: secondScheduledAt,
      now: secondScheduledAt,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActionLimitEnabled: false,
        linkedinDelayPatternMinutes: [5],
      }),
      transactionManager,
      workspaceId,
    });

    expect(replacementSlot?.toISOString()).toBe('2026-07-20T09:06:59.000Z');
    expect(workspaceMemberRepository.findOne).toHaveBeenNthCalledWith(1, {
      where: { id: ownerWorkspaceMemberId },
      select: ['id'],
      lock: { mode: 'pessimistic_write' },
    });
    expect(
      workspaceMemberRepository.findOne.mock.invocationCallOrder[0],
    ).toBeLessThan(
      linkedinActionRepository.findOne.mock.invocationCallOrder[0],
    );
    expect(
      linkedinActionRepository.findOne.mock.calls
        .slice(0, 3)
        .every(([options]) => options.withDeleted === true),
    ).toBe(true);
  });

  it('anchors pacing to provider start when navigation delayed the prior action', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { persistAction, service, transactionManager } = buildService();
    const secondScheduledAt = new Date('2026-07-20T09:05:00.000Z');

    persistAction(new Date('2026-07-20T09:00:00.000Z'), {
      claimedAt: new Date('2026-07-20T09:00:00.000Z'),
      executedAt: new Date('2026-07-20T09:04:00.000Z'),
      id: 'first-action-id',
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
    });
    persistAction(secondScheduledAt, { id: 'second-action-id' });

    const replacementSlot = await service.reserveClaimSlotIfTooEarly({
      actionId: 'second-action-id',
      actionScheduledAt: secondScheduledAt,
      now: secondScheduledAt,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActionLimitEnabled: false,
        linkedinDelayPatternMinutes: [5],
      }),
      transactionManager,
      workspaceId,
    });

    expect(replacementSlot?.toISOString()).toBe('2026-07-20T09:09:00.000Z');
  });

  it('preserves a two-minute actual claim gap after a ninety-second late claim', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { persistAction, service, transactionManager } = buildService();
    const firstScheduledAt = new Date('2026-07-20T09:00:00.000Z');
    const secondScheduledAt = new Date('2026-07-20T09:02:00.000Z');

    persistAction(firstScheduledAt, {
      claimedAt: new Date('2026-07-20T09:01:30.000Z'),
      id: 'first-action-id',
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
    });
    persistAction(secondScheduledAt, { id: 'second-action-id' });

    const replacementSlot = await service.reserveClaimSlotIfTooEarly({
      actionId: 'second-action-id',
      actionScheduledAt: secondScheduledAt,
      now: secondScheduledAt,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActionLimitEnabled: false,
        linkedinDelayPatternMinutes: [2],
      }),
      transactionManager,
      workspaceId,
    });

    expect(replacementSlot?.toISOString()).toBe('2026-07-20T09:03:30.000Z');
  });

  it('keeps the owner lock through a claim that already satisfies actual pacing', async () => {
    const {
      linkedinActionRepository,
      persistAction,
      service,
      transactionManager,
      workspaceMemberRepository,
    } = buildService();
    const secondScheduledAt = new Date('2026-07-20T09:05:00.000Z');

    persistAction(new Date('2026-07-20T09:00:00.000Z'), {
      claimedAt: new Date('2026-07-20T08:59:00.000Z'),
      id: 'first-action-id',
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
    });

    await expect(
      service.reserveClaimSlotIfTooEarly({
        actionId: 'second-action-id',
        actionScheduledAt: secondScheduledAt,
        now: secondScheduledAt,
        ownerWorkspaceMemberId,
        settings: buildSettings({ linkedinDelayPatternMinutes: [5] }),
        transactionManager,
        workspaceId,
      }),
    ).resolves.toBeNull();

    expect(workspaceMemberRepository.findOne).toHaveBeenCalledTimes(1);
    expect(linkedinActionRepository.findOne).toHaveBeenCalledTimes(3);
    expect(
      workspaceMemberRepository.findOne.mock.invocationCallOrder[0],
    ).toBeLessThan(
      linkedinActionRepository.findOne.mock.invocationCallOrder[0],
    );
  });

  it('admits a claim whose deterministic UTC-day position is within the cap', async () => {
    const {
      linkedinActionRepository,
      service,
      transactionManager,
      workspaceMemberRepository,
    } = buildService();
    const actionScheduledAt = new Date('2026-07-20T12:00:00.000Z');

    linkedinActionRepository.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(19);

    await expect(
      service.reserveClaimSlotIfDailyCapExceeded({
        actionId: 'manual-action-20',
        actionScheduledAt,
        now: actionScheduledAt,
        ownerWorkspaceMemberId,
        settings: buildSettings({ linkedinDailyActions: 20 }),
        transactionManager,
        workspaceId,
      }),
    ).resolves.toBeNull();

    expect(linkedinActionRepository.count).toHaveBeenCalledTimes(2);
    expect(linkedinActionRepository.count).toHaveBeenLastCalledWith({
      where: [
        expect.objectContaining({
          ownerWorkspaceMemberId,
          scheduledAt: expect.anything(),
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        }),
        expect.objectContaining({
          id: expect.anything(),
          ownerWorkspaceMemberId,
          scheduledAt: actionScheduledAt,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
        }),
      ],
      withDeleted: true,
    });
    expect(
      workspaceMemberRepository.findOne.mock.invocationCallOrder[0],
    ).toBeLessThan(linkedinActionRepository.count.mock.invocationCallOrder[0]);
  });

  it('charges ordinary failed actions against the claim-time daily cap', async () => {
    const { linkedinActionRepository, service, transactionManager } =
      buildService();
    const actionScheduledAt = new Date('2026-07-20T12:00:00.000Z');
    const replacementSlot = new Date('2026-07-21T09:00:00.000Z');
    const reserveSlot = jest
      .spyOn(service, 'reserveSlot')
      .mockResolvedValue(replacementSlot);

    linkedinActionRepository.count
      .mockImplementationOnce(async (options) => {
        const failedWhere = (
          options.where as Array<{
            errorMessage?: FindOperator<string | null>;
            executedAt?: FindOperator<Date | null>;
            status: string | FindOperator<string[]>;
          }>
        ).find(({ status }) => status === LINKEDIN_ACTION_STATUSES.FAILED);

        expect(failedWhere?.executedAt?.type).toBe('not');
        expect(failedWhere?.errorMessage?.type).toBe('or');
        const [nullError, nonUnstartedError] = failedWhere?.errorMessage
          ?.value as unknown as Array<FindOperator<unknown>>;

        expect(nullError.type).toBe('isNull');
        expect(nonUnstartedError.type).toBe('not');
        expect(nonUnstartedError.value).toEqual([
          SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
          SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
        ]);

        return 1;
      })
      .mockResolvedValueOnce(0);

    await expect(
      service.reserveClaimSlotIfDailyCapExceeded({
        actionId: 'manual-action-after-failure',
        actionScheduledAt,
        now: actionScheduledAt,
        ownerWorkspaceMemberId,
        settings: buildSettings({ linkedinDailyActions: 1 }),
        transactionManager,
        workspaceId,
      }),
    ).resolves.toEqual(replacementSlot);

    expect(reserveSlot).toHaveBeenCalled();
  });

  it('counts only provider-started skips against the claim-time daily cap', async () => {
    const { linkedinActionRepository, service, transactionManager } =
      buildService();
    const actionScheduledAt = new Date('2026-07-20T12:00:00.000Z');

    linkedinActionRepository.count
      .mockImplementationOnce(async (options) => {
        const where = options.where as Array<{
          executedAt?: FindOperator<Date | null>;
          status: string | FindOperator<string[]>;
        }>;
        const skippedWhere = where.find(
          ({ status }) => status === LINKEDIN_ACTION_STATUSES.SKIPPED,
        );
        const groupedStatuses = where.find(
          ({ status }) => typeof status !== 'string',
        )?.status as FindOperator<string[]>;

        expect(skippedWhere?.executedAt?.type).toBe('not');
        expect(groupedStatuses.value).not.toContain(
          LINKEDIN_ACTION_STATUSES.SKIPPED,
        );

        return 0;
      })
      .mockResolvedValueOnce(0);

    await expect(
      service.reserveClaimSlotIfDailyCapExceeded({
        actionId: 'pre-start-skip-followup',
        actionScheduledAt,
        now: actionScheduledAt,
        ownerWorkspaceMemberId,
        settings: buildSettings({ linkedinDailyActions: 1 }),
        transactionManager,
        workspaceId,
      }),
    ).resolves.toBeNull();
  });

  it('leaves null-executed skips out of slot reservation quota while preserving pacing history', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const {
      linkedinActionRepository,
      persistAction,
      service,
      transactionManager,
    } = buildService();
    const skippedAt = new Date('2026-07-20T09:00:00.000Z');

    persistAction(skippedAt, {
      executedAt: null,
      status: LINKEDIN_ACTION_STATUSES.SKIPPED,
    });
    linkedinActionRepository.count.mockImplementation(async (options) => {
      const where = options.where as Array<{
        executedAt?: FindOperator<Date | null>;
        status: string | FindOperator<string[]>;
      }>;
      const skippedWhere = where.find(
        ({ status }) => status === LINKEDIN_ACTION_STATUSES.SKIPPED,
      );
      const groupedStatuses = where.find(
        ({ status }) => typeof status !== 'string',
      )?.status as FindOperator<string[]>;

      expect(skippedWhere?.executedAt?.type).toBe('not');
      expect(groupedStatuses.value).not.toContain(
        LINKEDIN_ACTION_STATUSES.SKIPPED,
      );

      return 0;
    });

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActions: 1,
        linkedinDelayPatternMinutes: [5],
      }),
      now: skippedAt,
      transactionManager,
    });

    expect(slot.toISOString()).toBe('2026-07-20T09:05:00.000Z');
  });

  it('re-slots a claim whose deterministic UTC-day position exceeds the cap', async () => {
    const { linkedinActionRepository, service, transactionManager } =
      buildService();
    const actionScheduledAt = new Date('2026-07-20T12:00:00.000Z');
    const replacementSlot = new Date('2026-07-21T09:00:00.000Z');
    const reserveSlot = jest
      .spyOn(service, 'reserveSlot')
      .mockResolvedValueOnce(replacementSlot);

    linkedinActionRepository.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(20);

    await expect(
      service.reserveClaimSlotIfDailyCapExceeded({
        actionId: 'manual-action-21',
        actionScheduledAt,
        now: actionScheduledAt,
        ownerWorkspaceMemberId,
        settings: buildSettings({ linkedinDailyActions: 20 }),
        transactionManager,
        workspaceId,
      }),
    ).resolves.toEqual(replacementSlot);

    expect(reserveSlot).toHaveBeenCalledWith({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: expect.objectContaining({ linkedinDailyActions: 20 }),
      now: actionScheduledAt,
      transactionManager,
      excludedActionId: 'manual-action-21',
    });
  });

  it('re-slots a backdated claim when already-admitted actions consumed the UTC cap', async () => {
    const { linkedinActionRepository, service, transactionManager } =
      buildService();
    const actionScheduledAt = new Date('2026-07-20T08:59:00.000Z');
    const replacementSlot = new Date('2026-07-21T09:00:00.000Z');
    const reserveSlot = jest
      .spyOn(service, 'reserveSlot')
      .mockResolvedValueOnce(replacementSlot);

    linkedinActionRepository.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await expect(
      service.reserveClaimSlotIfDailyCapExceeded({
        actionId: 'backdated-manual-action',
        actionScheduledAt,
        now: new Date('2026-07-20T09:01:00.000Z'),
        ownerWorkspaceMemberId,
        settings: buildSettings({ linkedinDailyActions: 1 }),
        transactionManager,
        workspaceId,
      }),
    ).resolves.toEqual(replacementSlot);

    expect(reserveSlot).toHaveBeenCalledTimes(1);
  });

  it('cycles the configured delay pattern and wraps', async () => {
    // A midpoint draw produces a neutral jitter factor, isolating the cycle.
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { persistAction, service, transactionManager } = buildService();
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActions: 20,
      linkedinDelayPatternMinutes: [1, 3, 5, 2, 8, 4, 6],
    });
    const slots: Date[] = [];

    for (let index = 0; index < 8; index += 1) {
      const slot = await service.reserveSlot({
        workspaceId,
        ownerWorkspaceMemberId,
        settings,
        now,
        transactionManager,
      });

      slots.push(slot);
      persistAction(slot);
    }

    expect(gapsInMinutes(slots, now)).toEqual([1, 3, 5, 2, 8, 4, 6, 1]);
  });

  it('jitters delays without leaving the configured pattern bounds', async () => {
    const { persistAction, service, transactionManager } = buildService();
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActions: 20,
      linkedinDelayPatternMinutes:
        DEFAULT_SEQUENCE_SETTINGS.linkedinDelayPatternMinutes,
    });
    const slots: Date[] = [];

    for (let index = 0; index < 14; index += 1) {
      const slot = await service.reserveSlot({
        workspaceId,
        ownerWorkspaceMemberId,
        settings,
        now,
        transactionManager,
      });

      slots.push(slot);
      persistAction(slot);
    }

    const gaps = gapsInMinutes(slots, now);

    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('rolls actions beyond the daily cap to the next active day', async () => {
    const {
      service,
      linkedinActionRepository,
      persistAction,
      transactionManager,
    } = buildService();
    linkedinActionRepository.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActions: 3,
      linkedinDelayPatternMinutes: [1],
    });
    const slots: Date[] = [];

    for (let index = 0; index < 5; index += 1) {
      const slot = await service.reserveSlot({
        workspaceId,
        ownerWorkspaceMemberId,
        settings,
        now,
        transactionManager,
      });

      slots.push(slot);
      persistAction(slot);
    }

    expect(slots.slice(0, 3).map((slot) => slot.getUTCDate())).toEqual([
      20, 20, 20,
    ]);
    expect(slots.slice(3).map((slot) => slot.getUTCDate())).toEqual([21, 21]);
    expect(slots[3].toISOString()).toBe('2026-07-21T09:00:00.000Z');
  });

  it('counts a soft-deleted completed action against the current UTC-day cap', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { linkedinActionRepository, service, transactionManager } =
      buildService();
    let countCall = 0;

    linkedinActionRepository.count.mockImplementation(async (options) => {
      countCall += 1;

      if (countCall === 1) {
        return options.withDeleted === true ? 1 : 0;
      }

      return 0;
    });

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActions: 1,
        linkedinDelayPatternMinutes: [1],
      }),
      now: new Date('2026-07-20T09:00:00.000Z'),
      transactionManager,
    });

    expect(slot.toISOString()).toBe('2026-07-21T09:00:00.000Z');
    expect(linkedinActionRepository.count).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ withDeleted: true }),
    );
  });

  it.each([
    SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
    SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
  ])(
    'releases the %s action slot while preserving its pacing gap',
    async (unstartedError) => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const {
        linkedinActionRepository,
        persistAction,
        service,
        transactionManager,
      } = buildService();
      const failedAt = new Date('2026-07-20T09:00:00.000Z');

      persistAction(failedAt, {
        errorMessage: unstartedError,
        executedAt: failedAt,
        status: LINKEDIN_ACTION_STATUSES.FAILED,
      });
      linkedinActionRepository.count.mockImplementation(async (options) => {
        const failedWhere = (
          options.where as Array<{
            errorMessage?: FindOperator<string | null>;
            executedAt?: FindOperator<Date | null>;
            status: string | FindOperator<string[]>;
          }>
        ).find(({ status }) => status === LINKEDIN_ACTION_STATUSES.FAILED);

        expect(failedWhere?.executedAt?.type).toBe('not');
        expect(failedWhere?.errorMessage?.type).toBe('or');

        return 0;
      });

      const slot = await service.reserveSlot({
        workspaceId,
        ownerWorkspaceMemberId,
        settings: buildSettings({
          linkedinDailyActions: 1,
          linkedinDelayPatternMinutes: [5],
        }),
        now: failedAt,
        transactionManager,
      });

      expect(slot.toISOString()).toBe('2026-07-20T09:05:00.000Z');
    },
  );

  it('releases a null-executed failure with an arbitrary reason from the daily cap', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const {
      linkedinActionRepository,
      persistAction,
      service,
      transactionManager,
    } = buildService();
    const failedAt = new Date('2026-07-20T09:00:00.000Z');

    persistAction(failedAt, {
      errorMessage: 'LinkedIn invitation button was not found',
      executedAt: null,
      status: LINKEDIN_ACTION_STATUSES.FAILED,
    });
    linkedinActionRepository.count.mockImplementation(async (options) => {
      const failedWhere = (
        options.where as Array<{
          executedAt?: FindOperator<Date | null>;
          status: string | FindOperator<string[]>;
        }>
      ).find(({ status }) => status === LINKEDIN_ACTION_STATUSES.FAILED);

      // TypeORM translates Not(IsNull()) into the durable provider-start
      // predicate. The descriptive error text is deliberately irrelevant.
      expect(failedWhere?.executedAt?.type).toBe('not');

      return 0;
    });

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActions: 1,
        linkedinDelayPatternMinutes: [5],
      }),
      now: failedAt,
      transactionManager,
    });

    expect(slot.toISOString()).toBe('2026-07-20T09:05:00.000Z');
  });

  it('keeps an ordinary failed action in both the daily cap and pacing history', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const {
      linkedinActionRepository,
      persistAction,
      service,
      transactionManager,
    } = buildService();
    const failedAt = new Date('2026-07-20T09:00:00.000Z');
    let countCall = 0;

    persistAction(failedAt, {
      errorMessage: 'LinkedIn did not open a recognized invitation dialog',
      executedAt: failedAt,
      status: LINKEDIN_ACTION_STATUSES.FAILED,
    });
    linkedinActionRepository.count.mockImplementation(async () => {
      countCall += 1;

      return countCall === 1 ? 1 : 0;
    });

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActions: 1,
        linkedinDelayPatternMinutes: [5],
      }),
      now: failedAt,
      transactionManager,
    });

    expect(slot.toISOString()).toBe('2026-07-21T09:00:00.000Z');
  });

  it('uses soft-deleted terminal history in the persisted pacing horizon', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { persistAction, service, transactionManager } = buildService();

    persistAction(new Date('2026-07-20T09:00:00.000Z'), {
      claimedAt: new Date('2026-07-20T09:00:00.000Z'),
      deletedAt: '2026-07-20T09:01:00.000Z',
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
    });

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActionLimitEnabled: false,
        linkedinDelayPatternMinutes: [5],
      }),
      now: new Date('2026-07-20T08:58:00.000Z'),
      transactionManager,
    });

    expect(slot.toISOString()).toBe('2026-07-20T09:05:00.000Z');
  });

  it('searches past more than fifteen full days instead of failing the enrollment', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const {
      service,
      linkedinActionRepository,
      persistAction,
      transactionManager,
    } = buildService();
    const firstFullDay = new Date('2026-07-20T09:00:00.000Z');

    for (let dayOffset = 0; dayOffset < 16; dayOffset += 1) {
      persistAction(
        new Date(firstFullDay.getTime() + dayOffset * 24 * 60 * 60 * 1000),
      );
    }

    let dayCountCall = 0;

    linkedinActionRepository.count.mockImplementation(async () => {
      dayCountCall += 1;

      return dayCountCall <= 16 ? 1 : 0;
    });

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        linkedinDailyActions: 1,
        linkedinDelayPatternMinutes: [1],
      }),
      now: new Date('2026-07-20T08:59:00.000Z'),
      transactionManager,
    });

    expect(slot.toISOString()).toBe('2026-08-05T09:00:00.000Z');
    expect(linkedinActionRepository.count).toHaveBeenCalledTimes(17);
  });

  it('shares the daily cap and safety gap for one LinkedIn account', async () => {
    const {
      service,
      linkedinActionRepository,
      persistAction,
      transactionManager,
    } = buildService();
    linkedinActionRepository.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActions: 2,
      linkedinDelayPatternMinutes: [15],
    });

    const firstSlot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now,
      transactionManager,
    });

    persistAction(firstSlot);

    const secondSlot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now,
      transactionManager,
    });

    persistAction(secondSlot);

    const thirdSlot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now,
      transactionManager,
    });

    expect(firstSlot.toISOString()).toBe('2026-07-20T09:15:00.000Z');
    expect(secondSlot.toISOString()).toBe('2026-07-20T09:30:00.000Z');
    expect(thirdSlot.toISOString()).toBe('2026-07-21T09:00:00.000Z');
  });

  it('always returns a slot inside the configured sending window', async () => {
    const { service, transactionManager } = buildService();
    const settings = buildSettings({
      activeDays: [1, 3, 5],
      windowStart: '10:30',
      windowEnd: '11:00',
      linkedinDelayPatternMinutes: [180],
    });

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now: new Date('2026-07-20T17:00:00.000Z'),
      transactionManager,
    });

    expect(slot.toISOString()).toBe('2026-07-22T10:30:00.000Z');
    expect(isWithinSendingWindow(slot, settings)).toBe(true);
  });

  it('gives each LinkedIn account its own pacing and daily budget', async () => {
    const { service, transactionManager, values } = buildService();
    const settings = buildSettings();
    const now = new Date('2026-07-20T09:00:00.000Z');

    await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId: 'member-a',
      settings,
      now,
      transactionManager,
    });
    await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId: 'member-b',
      settings,
      now,
      transactionManager,
    });

    const keys = [...values.keys()];
    const memberAKeys = keys.filter((key) => key.includes('member-a'));
    const memberBKeys = keys.filter((key) => key.includes('member-b'));

    // A LinkedIn limit belongs to an account. Two members running outreach from
    // the same workspace must not share one delay chain or one daily budget.
    expect(memberAKeys.length).toBeGreaterThan(0);
    expect(memberBKeys.length).toBe(memberAKeys.length);
    expect(memberAKeys.some((key) => memberBKeys.includes(key))).toBe(false);
  });

  it('does not roll one account when another account has exhausted its budget', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { service, linkedinActionRepository, transactionManager } =
      buildService();
    const settings = buildSettings({
      linkedinDailyActions: 1,
      linkedinDelayPatternMinutes: [1],
    });

    linkedinActionRepository.count
      // Account A is full today and open tomorrow; account B is open today.
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const accountASlot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId: 'member-a',
      settings,
      now: new Date('2026-07-20T09:00:00.000Z'),
      transactionManager,
    });
    const accountBSlot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId: 'member-b',
      settings,
      now: new Date('2026-07-20T09:00:00.000Z'),
      transactionManager,
    });

    expect(accountASlot.toISOString()).toBe('2026-07-21T09:00:00.000Z');
    expect(accountBSlot.toISOString()).toBe('2026-07-20T09:01:00.000Z');
    expect(linkedinActionRepository.count).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({
            ownerWorkspaceMemberId: 'member-a',
          }),
        ]),
      }),
    );
    expect(linkedinActionRepository.count).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({
            ownerWorkspaceMemberId: 'member-b',
          }),
        ]),
      }),
    );
  });

  it('recovers the durable daily budget after the cache is cleared', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const {
      service,
      linkedinActionRepository,
      transactionManager,
      values,
      workspaceMemberRepository,
    } = buildService();
    const settings = buildSettings({
      linkedinDailyActions: 1,
      linkedinDelayPatternMinutes: [15],
    });

    linkedinActionRepository.findOne.mockResolvedValue({
      scheduledAt: new Date('2026-07-20T09:15:00.000Z'),
    });
    linkedinActionRepository.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now: new Date('2026-07-20T09:00:00.000Z'),
      transactionManager,
    });

    expect(slot.toISOString()).toBe('2026-07-21T09:00:00.000Z');
    expect(workspaceMemberRepository.findOne).toHaveBeenCalledWith({
      where: { id: ownerWorkspaceMemberId },
      select: ['id'],
      lock: { mode: 'pessimistic_write' },
    });
    expect(linkedinActionRepository.count).toHaveBeenCalledTimes(2);
    expect(linkedinActionRepository.count).toHaveBeenCalledWith({
      where: expect.arrayContaining([
        expect.objectContaining({
          ownerWorkspaceMemberId,
          status: expect.anything(),
          scheduledAt: expect.anything(),
        }),
      ]),
      withDeleted: true,
    });
    expect(
      workspaceMemberRepository.findOne.mock.invocationCallOrder[0],
    ).toBeLessThan(linkedinActionRepository.count.mock.invocationCallOrder[0]);
    expect([...values.keys()].some((key) => key.includes('daily-count'))).toBe(
      false,
    );
  });

  it('does not count a stale claimed action against its replacement slot', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const {
      service,
      linkedinActionRepository,
      persistAction,
      transactionManager,
    } = buildService();
    const staleActionId = 'stale-claimed-action-id';

    persistAction(new Date('2026-07-20T09:00:00.000Z'), {
      id: staleActionId,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
    });

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActions: 1,
        linkedinDelayPatternMinutes: [15],
      }),
      now: new Date('2026-07-20T09:00:00.000Z'),
      transactionManager,
      excludedActionId: staleActionId,
    });

    expect(slot.toISOString()).toBe('2026-07-20T09:15:00.000Z');
    expect(linkedinActionRepository.count).toHaveBeenCalledWith({
      where: expect.arrayContaining([
        expect.objectContaining({
          id: expect.anything(),
          ownerWorkspaceMemberId,
        }),
      ]),
      withDeleted: true,
    });
  });

  it('rolls an offline backlog action when the current UTC day is full', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const {
      service,
      linkedinActionRepository,
      persistAction,
      transactionManager,
    } = buildService();
    const staleActionId = 'prior-day-claimed-action-id';

    persistAction(new Date('2026-07-20T23:55:00.000Z'), {
      id: staleActionId,
      status: LINKEDIN_ACTION_STATUSES.CLAIMED,
    });
    linkedinActionRepository.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        windowStart: '00:00',
        windowEnd: '00:00',
        linkedinDailyActions: 1,
        linkedinDelayPatternMinutes: [1],
      }),
      now: new Date('2026-07-21T00:01:00.000Z'),
      transactionManager,
      excludedActionId: staleActionId,
    });

    expect(slot.toISOString()).toBe('2026-07-22T00:00:00.000Z');
    expect(linkedinActionRepository.count).toHaveBeenCalledTimes(2);
  });

  it('rewinds a cached pacing watermark when pause cancelled that slot', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { service, linkedinActionRepository, transactionManager, values } =
      buildService();
    const cachedLastActionKey =
      `${SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX}:` +
      `${workspaceId}:${ownerWorkspaceMemberId}`;

    values.set(cachedLastActionKey, '2026-07-22T16:00:00.000Z');
    linkedinActionRepository.findOne
      .mockResolvedValueOnce({
        scheduledAt: new Date('2026-07-20T09:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'cancelled-action-id',
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
      });

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDelayPatternMinutes: [15],
      }),
      now: new Date('2026-07-20T09:00:00.000Z'),
      transactionManager,
    });

    expect(linkedinActionRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: {
        ownerWorkspaceMemberId,
        scheduledAt: new Date('2026-07-22T16:00:00.000Z'),
      },
      select: ['id', 'status'],
      withDeleted: true,
    });
    expect(slot.toISOString()).toBe('2026-07-20T09:15:00.000Z');
    expect(values.get(cachedLastActionKey)).toBe('2026-07-20T09:15:00.000Z');
  });

  it('discards a cached reservation whose action insert rolled back', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { service, linkedinActionRepository, transactionManager, values } =
      buildService();
    const cachedLastActionKey =
      `${SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX}:` +
      `${workspaceId}:${ownerWorkspaceMemberId}`;

    values.set(cachedLastActionKey, '2026-07-27T09:15:00.000Z');
    linkedinActionRepository.findOne.mockResolvedValue(null);

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDelayPatternMinutes: [15],
      }),
      now: new Date('2026-07-20T09:00:00.000Z'),
      transactionManager,
    });

    expect(linkedinActionRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: {
        ownerWorkspaceMemberId,
        scheduledAt: new Date('2026-07-27T09:15:00.000Z'),
      },
      select: ['id', 'status'],
      withDeleted: true,
    });
    expect(slot.toISOString()).toBe('2026-07-20T09:15:00.000Z');
    expect(values.get(cachedLastActionKey)).toBe('2026-07-20T09:15:00.000Z');
  });

  it('uses an earlier free slot after reserving a far-future withdrawal', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { persistAction, service, transactionManager, values } =
      buildService();
    const settings = buildSettings({
      linkedinDailyActions: 20,
      linkedinDelayPatternMinutes: [15],
    });

    const withdrawalSlot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now: new Date('2026-07-27T09:00:00.000Z'),
      transactionManager,
    });

    expect(withdrawalSlot.toISOString()).toBe('2026-07-27T09:15:00.000Z');

    persistAction(withdrawalSlot, {
      id: 'future-withdrawal-id',
      type: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
    });

    const immediateSlot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now: new Date('2026-07-20T09:00:00.000Z'),
      transactionManager,
    });
    const cachedLastActionKey =
      `${SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX}:` +
      `${workspaceId}:${ownerWorkspaceMemberId}`;

    expect(immediateSlot.toISOString()).toBe('2026-07-20T09:15:00.000Z');
    expect(values.get(cachedLastActionKey)).toBe('2026-07-20T09:15:00.000Z');
  });

  it('moves after a future action when the earlier gap is too narrow', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { persistAction, service, transactionManager } = buildService();

    persistAction(new Date('2026-07-20T09:20:00.000Z'));

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings: buildSettings({
        linkedinDailyActions: 20,
        linkedinDelayPatternMinutes: [15],
      }),
      now: new Date('2026-07-20T09:00:00.000Z'),
      transactionManager,
    });

    expect(slot.toISOString()).toBe('2026-07-20T09:35:00.000Z');
  });

  it('uses one UTC reset boundary across sequence timezones', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { service, linkedinActionRepository, transactionManager } =
      buildService();
    const settings = buildSettings({
      timezone: 'America/Los_Angeles',
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      windowStart: '00:00',
      windowEnd: '00:00',
      linkedinDailyActions: 1,
      linkedinDelayPatternMinutes: [1],
    });

    linkedinActionRepository.findOne.mockResolvedValue({
      scheduledAt: new Date('2026-07-20T23:58:00.000Z'),
    });
    linkedinActionRepository.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const slot = await service.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now: new Date('2026-07-20T23:58:00.000Z'),
      transactionManager,
    });

    // Midnight UTC is 17:00 on the prior Los Angeles calendar day. A
    // sequence-local counter would instead roll this slot to 07:00 UTC.
    expect(slot.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  });

  it('rejects a reservation outside the action insert transaction', async () => {
    const { service, transactionManager } = buildService({
      isTransactionActive: false,
    });

    await expect(
      service.reserveSlot({
        workspaceId,
        ownerWorkspaceMemberId,
        settings: buildSettings(),
        now: new Date('2026-07-20T09:00:00.000Z'),
        transactionManager,
      }),
    ).rejects.toThrow(
      'LinkedIn slots must be reserved inside the action insert transaction',
    );
  });
});
