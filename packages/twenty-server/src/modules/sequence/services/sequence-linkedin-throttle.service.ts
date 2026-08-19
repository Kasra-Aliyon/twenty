import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  LINKEDIN_ACTION_STATUSES,
  type LinkedInActionStatus,
  type SequenceSettings,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import {
  And,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Or,
} from 'typeorm';

import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import {
  SEQUENCE_LINKEDIN_ACTION_LOCK_KEY_PREFIX,
  SEQUENCE_LINKEDIN_ACTION_LOCK_TTL,
  SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX,
  SEQUENCE_LINKEDIN_PATTERN_INDEX_CACHE_KEY_PREFIX,
  SEQUENCE_LINKEDIN_THROTTLE_CACHE_TTL,
  SEQUENCE_EXECUTION_ERROR,
} from 'src/modules/sequence/sequence.constants';
import {
  isWithinSendingWindow,
  nextWindowOpen,
} from 'src/modules/sequence/utils/sequence-window.util';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const LINKEDIN_THROTTLE_LOCK_RETRY_COUNT = 10;
const LINKEDIN_THROTTLE_LOCK_RETRY_DELAY_MILLISECONDS = 10;
const LINKEDIN_DELAY_JITTER_RATIO = 0.25;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
// executedAt is the durable provider-start signal. Explicit markers also keep
// legacy unstarted rows with a fabricated timestamp from consuming quota.
const LINKEDIN_UNSTARTED_ACTION_ERRORS = [
  SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED,
  SEQUENCE_EXECUTION_ERROR.LINKEDIN_ACTION_UNSTARTED_EXPIRED,
] as const;
const LINKEDIN_DAILY_CAP_COUNTED_NON_FAILED_STATUSES: LinkedInActionStatus[] = [
  LINKEDIN_ACTION_STATUSES.SCHEDULED,
  LINKEDIN_ACTION_STATUSES.CLAIMED,
  LINKEDIN_ACTION_STATUSES.COMPLETED,
];
const LINKEDIN_DAILY_CAP_ADMITTED_NON_FAILED_STATUSES: LinkedInActionStatus[] =
  [LINKEDIN_ACTION_STATUSES.CLAIMED, LINKEDIN_ACTION_STATUSES.COMPLETED];
const LINKEDIN_PACING_STATUSES: LinkedInActionStatus[] = [
  ...LINKEDIN_DAILY_CAP_COUNTED_NON_FAILED_STATUSES,
  LINKEDIN_ACTION_STATUSES.SKIPPED,
  LINKEDIN_ACTION_STATUSES.FAILED,
];

@Injectable()
export class SequenceLinkedinThrottleService {
  constructor(
    @InjectCacheStorage(CacheStorageNamespace.ModuleMessaging)
    private readonly cacheStorageService: CacheStorageService,
  ) {}

  // Pacing and the daily cap are properties of a LinkedIn account, not of the
  // workspace: two members each running outreach from their own account must
  // not share one delay chain or one daily budget.
  async reserveSlot({
    workspaceId,
    ownerWorkspaceMemberId,
    settings,
    now,
    transactionManager,
    excludedActionId,
    minimumScheduledAt,
  }: {
    workspaceId: string;
    ownerWorkspaceMemberId: string;
    settings: SequenceSettings;
    now: Date;
    transactionManager: WorkspaceEntityManager;
    excludedActionId?: string;
    minimumScheduledAt?: Date;
  }): Promise<Date> {
    const senderKey = `${workspaceId}:${ownerWorkspaceMemberId}`;
    const lockKey = this.getLockKey(senderKey);

    this.assertActiveTransaction(transactionManager);

    const workspaceMemberRepository = transactionManager.getRepository(
      WorkspaceMemberWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const linkedinActionRepository = transactionManager.getRepository(
      LinkedinActionWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const excludedActionCondition = isDefined(excludedActionId)
      ? { id: Not(excludedActionId) }
      : {};
    const owner = await workspaceMemberRepository.findOne({
      where: { id: ownerWorkspaceMemberId },
      select: ['id'],
      lock: { mode: 'pessimistic_write' },
    });

    if (!isDefined(owner)) {
      throw new Error(
        `Could not lock LinkedIn owner ${ownerWorkspaceMemberId}`,
      );
    }

    const lockToken = await this.acquireLock(lockKey);

    if (!isDefined(lockToken)) {
      throw new Error('Could not acquire the LinkedIn sequence throttle lock');
    }

    try {
      const [
        lastActionAtValue,
        patternIndexValue,
        latestPersistedActionAtOrBeforeNow,
      ] = await Promise.all([
        this.cacheStorageService.get<string>(
          this.getLastActionAtKey(senderKey),
        ),
        this.cacheStorageService.get<number>(
          this.getPatternIndexKey(senderKey),
        ),
        linkedinActionRepository.findOne({
          where: {
            ...excludedActionCondition,
            ownerWorkspaceMemberId,
            status: In(LINKEDIN_PACING_STATUSES),
            scheduledAt: LessThanOrEqual(now),
          },
          order: { scheduledAt: 'DESC' },
          select: ['scheduledAt'],
          withDeleted: true,
        }),
      ]);
      const cachedLastActionTimestamp = isDefined(lastActionAtValue)
        ? Date.parse(lastActionAtValue)
        : Number.NaN;

      // The owner row lock makes the database authoritative here. A cache
      // timestamp without an exact persisted action came from a rolled-back
      // insert and must not block this account until the cache expires.
      const cachedAction = !Number.isNaN(cachedLastActionTimestamp)
        ? await linkedinActionRepository.findOne({
            where: {
              ...excludedActionCondition,
              ownerWorkspaceMemberId,
              scheduledAt: new Date(cachedLastActionTimestamp),
            },
            select: ['id', 'status'],
            withDeleted: true,
          })
        : null;
      const isCachedActionUsable =
        isDefined(cachedAction) &&
        cachedAction.status !== LINKEDIN_ACTION_STATUSES.CANCELLED;
      const usableCachedLastActionTimestamp = isCachedActionUsable
        ? cachedLastActionTimestamp
        : Number.NaN;
      const persistedActionAtOrBeforeNowTimestamp =
        latestPersistedActionAtOrBeforeNow?.scheduledAt?.getTime() ??
        Number.NaN;
      const patternIndex =
        isCachedActionUsable &&
        typeof patternIndexValue === 'number' &&
        Number.isInteger(patternIndexValue) &&
        patternIndexValue >= 0
          ? patternIndexValue
          : 0;
      const delayMinutes = this.getJitteredDelayMinutes(
        settings.linkedinDelayPatternMinutes,
        patternIndex,
      );
      const delayMilliseconds = Math.round(delayMinutes * 60) * 1000;
      const maximumDelayMilliseconds =
        Math.round(Math.max(...settings.linkedinDelayPatternMinutes) * 60) *
        1000;
      const appendHorizonTimestamp = Math.max(
        now.getTime(),
        Number.isNaN(persistedActionAtOrBeforeNowTimestamp)
          ? now.getTime()
          : persistedActionAtOrBeforeNowTimestamp,
      );
      let candidate = isDefined(minimumScheduledAt)
        ? new Date(Math.max(now.getTime(), minimumScheduledAt.getTime()))
        : new Date(appendHorizonTimestamp + delayMilliseconds);

      if (!isWithinSendingWindow(candidate, settings)) {
        candidate = nextWindowOpen(candidate, settings);
      }

      while (true) {
        const { previousActionTimestamp, nextActionTimestamp } =
          await this.getPersistedActionNeighbors({
            linkedinActionRepository,
            ownerWorkspaceMemberId,
            candidate,
            excludedActionId,
          });
        const candidateTimestamp = candidate.getTime();
        const previousReservationTimestamp = Math.max(
          previousActionTimestamp,
          !Number.isNaN(usableCachedLastActionTimestamp) &&
            usableCachedLastActionTimestamp < candidateTimestamp
            ? usableCachedLastActionTimestamp
            : Number.NEGATIVE_INFINITY,
        );

        if (
          Number.isFinite(previousReservationTimestamp) &&
          candidateTimestamp - previousReservationTimestamp < delayMilliseconds
        ) {
          candidate = new Date(
            previousReservationTimestamp + delayMilliseconds,
          );

          if (!isWithinSendingWindow(candidate, settings)) {
            candidate = nextWindowOpen(candidate, settings);
          }

          continue;
        }

        const nextReservationTimestamp = Math.min(
          nextActionTimestamp,
          !Number.isNaN(usableCachedLastActionTimestamp) &&
            usableCachedLastActionTimestamp >= candidateTimestamp
            ? usableCachedLastActionTimestamp
            : Number.POSITIVE_INFINITY,
        );

        // The sampled delay used to create an existing future action is not
        // persisted. Requiring the configured maximum before that successor
        // preserves every possible pattern gap at the cost of skipping narrow
        // holes; genuinely earlier free slots remain available.
        if (
          Number.isFinite(nextReservationTimestamp) &&
          nextReservationTimestamp - candidateTimestamp <
            maximumDelayMilliseconds
        ) {
          candidate = new Date(nextReservationTimestamp + delayMilliseconds);

          if (!isWithinSendingWindow(candidate, settings)) {
            candidate = nextWindowOpen(candidate, settings);
          }

          continue;
        }

        if (!settings.linkedinDailyActionLimitEnabled) {
          break;
        }

        const scheduledDayCount = await this.getScheduledDayCount({
          linkedinActionRepository,
          ownerWorkspaceMemberId,
          candidate,
          excludedActionId,
        });

        if (scheduledDayCount < settings.linkedinDailyActions) {
          break;
        }

        // The cap is parsed to at least one action and this transaction sees a
        // finite set of reservations. Advancing one UTC day therefore finds
        // capacity no later than the first day after the latest persisted row;
        // a fixed lookahead would instead make a temporary backlog terminal.
        candidate = this.getNextUtcDayWindowOpen(candidate, settings);
      }

      const cacheWrites = [
        this.cacheStorageService.set(
          this.getLastActionAtKey(senderKey),
          candidate.toISOString(),
          SEQUENCE_LINKEDIN_THROTTLE_CACHE_TTL,
        ),
        this.cacheStorageService.set(
          this.getPatternIndexKey(senderKey),
          patternIndex + 1,
          SEQUENCE_LINKEDIN_THROTTLE_CACHE_TTL,
        ),
      ];

      await Promise.all(cacheWrites);

      return candidate;
    } finally {
      await this.cacheStorageService.releaseLockWithToken(lockKey, lockToken);
    }
  }

  async reserveClaimSlotIfTooEarly({
    actionId,
    actionScheduledAt,
    now,
    ownerWorkspaceMemberId,
    settings,
    transactionManager,
    workspaceId,
  }: {
    actionId: string;
    actionScheduledAt: Date;
    now: Date;
    ownerWorkspaceMemberId: string;
    settings: SequenceSettings;
    transactionManager: WorkspaceEntityManager;
    workspaceId: string;
  }): Promise<Date | null> {
    this.assertActiveTransaction(transactionManager);

    const workspaceMemberRepository = transactionManager.getRepository(
      WorkspaceMemberWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const linkedinActionRepository = transactionManager.getRepository(
      LinkedinActionWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const owner = await workspaceMemberRepository.findOne({
      where: { id: ownerWorkspaceMemberId },
      select: ['id'],
      lock: { mode: 'pessimistic_write' },
    });

    if (!isDefined(owner)) {
      throw new Error(
        `Could not lock LinkedIn owner ${ownerWorkspaceMemberId}`,
      );
    }

    const [
      latestClaimedAction,
      latestExecutionStartedAction,
      precedingScheduledAction,
    ] = await Promise.all([
      linkedinActionRepository.findOne({
        where: {
          id: Not(actionId),
          ownerWorkspaceMemberId,
          status: In(LINKEDIN_PACING_STATUSES),
          claimedAt: Not(IsNull()),
        },
        order: { claimedAt: 'DESC' },
        select: ['claimedAt'],
        withDeleted: true,
      }),
      linkedinActionRepository.findOne({
        where: {
          id: Not(actionId),
          ownerWorkspaceMemberId,
          status: In(LINKEDIN_PACING_STATUSES),
          executedAt: Not(IsNull()),
        },
        order: { executedAt: 'DESC' },
        select: ['executedAt'],
        withDeleted: true,
      }),
      linkedinActionRepository.findOne({
        where: {
          id: Not(actionId),
          ownerWorkspaceMemberId,
          status: In(LINKEDIN_PACING_STATUSES),
          scheduledAt: LessThan(actionScheduledAt),
        },
        order: { scheduledAt: 'DESC' },
        select: ['scheduledAt'],
        withDeleted: true,
      }),
    ]);
    const latestActionStartTimestamp = Math.max(
      latestClaimedAction?.claimedAt?.getTime() ?? 0,
      latestExecutionStartedAction?.executedAt?.getTime() ?? 0,
    );

    if (latestActionStartTimestamp === 0) {
      return null;
    }

    const minimumDelayMilliseconds =
      Math.min(...settings.linkedinDelayPatternMinutes) * 60_000;
    const maximumDelayMilliseconds =
      Math.max(...settings.linkedinDelayPatternMinutes) * 60_000;
    const persistedGapMilliseconds = isDefined(
      precedingScheduledAction?.scheduledAt,
    )
      ? actionScheduledAt.getTime() -
        precedingScheduledAction.scheduledAt.getTime()
      : minimumDelayMilliseconds;
    const intendedGapMilliseconds = Math.min(
      maximumDelayMilliseconds,
      Math.max(minimumDelayMilliseconds, persistedGapMilliseconds),
    );
    // A claim can precede browser navigation and preflight by several minutes.
    // Once the runner reports the provider-start timestamp, that later durable
    // boundary must anchor the next gap or real outreach can bunch together.
    const earliestClaimAt = new Date(
      latestActionStartTimestamp + intendedGapMilliseconds,
    );

    if (now.getTime() >= earliestClaimAt.getTime()) {
      return null;
    }

    return this.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now,
      transactionManager,
      excludedActionId: actionId,
      minimumScheduledAt: earliestClaimAt,
    });
  }

  async reserveClaimSlotIfDailyCapExceeded({
    actionId,
    actionScheduledAt,
    now,
    ownerWorkspaceMemberId,
    settings,
    transactionManager,
    workspaceId,
  }: {
    actionId: string;
    actionScheduledAt: Date;
    now: Date;
    ownerWorkspaceMemberId: string;
    settings: SequenceSettings;
    transactionManager: WorkspaceEntityManager;
    workspaceId: string;
  }): Promise<Date | null> {
    this.assertActiveTransaction(transactionManager);

    if (!settings.linkedinDailyActionLimitEnabled) {
      return null;
    }

    const workspaceMemberRepository = transactionManager.getRepository(
      WorkspaceMemberWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const linkedinActionRepository = transactionManager.getRepository(
      LinkedinActionWorkspaceEntity,
      { shouldBypassPermissionChecks: true },
    );
    const owner = await workspaceMemberRepository.findOne({
      where: { id: ownerWorkspaceMemberId },
      select: ['id'],
      lock: { mode: 'pessimistic_write' },
    });

    if (!isDefined(owner)) {
      throw new Error(
        `Could not lock LinkedIn owner ${ownerWorkspaceMemberId}`,
      );
    }

    const dayStart = this.getUtcDayStart(actionScheduledAt);
    const nextDayStart = new Date(dayStart.getTime() + MILLISECONDS_PER_DAY);
    const admittedActionBaseWhere = {
      id: Not(actionId),
      ownerWorkspaceMemberId,
      scheduledAt: And(MoreThanOrEqual(dayStart), LessThan(nextDayStart)),
    };
    const [admittedActionCount, precedingScheduledActionCount] =
      await Promise.all([
        linkedinActionRepository.count({
          where: [
            {
              ...admittedActionBaseWhere,
              status: In(LINKEDIN_DAILY_CAP_ADMITTED_NON_FAILED_STATUSES),
            },
            {
              ...admittedActionBaseWhere,
              status: LINKEDIN_ACTION_STATUSES.SKIPPED,
              executedAt: Not(IsNull()),
            },
            {
              ...admittedActionBaseWhere,
              status: LINKEDIN_ACTION_STATUSES.FAILED,
              executedAt: Not(IsNull()),
              errorMessage: Or(
                IsNull(),
                Not(In([...LINKEDIN_UNSTARTED_ACTION_ERRORS])),
              ),
            },
          ],
          withDeleted: true,
        }),
        linkedinActionRepository.count({
          where: [
            {
              id: Not(actionId),
              ownerWorkspaceMemberId,
              status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
              scheduledAt: And(
                MoreThanOrEqual(dayStart),
                LessThan(actionScheduledAt),
              ),
            },
            {
              id: And(Not(actionId), LessThan(actionId)),
              ownerWorkspaceMemberId,
              status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
              scheduledAt: actionScheduledAt,
            },
          ],
          withDeleted: true,
        }),
      ]);

    // Already claimed or terminal rows have consumed admission regardless of
    // where a newly created backdated action sorts. Remaining SCHEDULED rows
    // use a stable scheduledAt/id order for the unconsumed part of the budget.
    if (
      admittedActionCount + precedingScheduledActionCount <
      settings.linkedinDailyActions
    ) {
      return null;
    }

    return this.reserveSlot({
      workspaceId,
      ownerWorkspaceMemberId,
      settings,
      now,
      transactionManager,
      excludedActionId: actionId,
    });
  }

  private async acquireLock(lockKey: string): Promise<string | null> {
    const lockToken = randomUUID();

    for (
      let attempt = 0;
      attempt < LINKEDIN_THROTTLE_LOCK_RETRY_COUNT;
      attempt += 1
    ) {
      if (
        await this.cacheStorageService.acquireLockWithToken(
          lockKey,
          lockToken,
          SEQUENCE_LINKEDIN_ACTION_LOCK_TTL,
        )
      ) {
        return lockToken;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, LINKEDIN_THROTTLE_LOCK_RETRY_DELAY_MILLISECONDS),
      );
    }

    return null;
  }

  // Cycling the pattern keeps the long-run average equal to the configured
  // spacing, but a bare cycle repeats the exact same gaps forever, which is a
  // fingerprint LinkedIn can match on. Each delay is jittered around its
  // pattern value and clamped to the pattern's own bounds, so the configured
  // minimum and maximum spacing still hold.
  private getJitteredDelayMinutes(
    patternMinutes: number[],
    patternIndex: number,
  ): number {
    const baseDelayMinutes =
      patternMinutes[patternIndex % patternMinutes.length];
    const lowerBoundMinutes = Math.min(...patternMinutes);
    const upperBoundMinutes = Math.max(...patternMinutes);
    const jitterFactor =
      1 + (Math.random() * 2 - 1) * LINKEDIN_DELAY_JITTER_RATIO;

    return Math.min(
      upperBoundMinutes,
      Math.max(lowerBoundMinutes, baseDelayMinutes * jitterFactor),
    );
  }

  private async getScheduledDayCount({
    linkedinActionRepository,
    ownerWorkspaceMemberId,
    candidate,
    excludedActionId,
  }: {
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    ownerWorkspaceMemberId: string;
    candidate: Date;
    excludedActionId?: string;
  }): Promise<number> {
    const dayStart = this.getUtcDayStart(candidate);
    const nextDayStart = new Date(dayStart.getTime() + MILLISECONDS_PER_DAY);
    const dailyCountBaseWhere = {
      ...(isDefined(excludedActionId) ? { id: Not(excludedActionId) } : {}),
      ownerWorkspaceMemberId,
      scheduledAt: And(MoreThanOrEqual(dayStart), LessThan(nextDayStart)),
    };

    return linkedinActionRepository.count({
      where: [
        {
          ...dailyCountBaseWhere,
          status: In(LINKEDIN_DAILY_CAP_COUNTED_NON_FAILED_STATUSES),
        },
        {
          ...dailyCountBaseWhere,
          status: LINKEDIN_ACTION_STATUSES.SKIPPED,
          executedAt: Not(IsNull()),
        },
        {
          ...dailyCountBaseWhere,
          status: LINKEDIN_ACTION_STATUSES.FAILED,
          executedAt: Not(IsNull()),
          errorMessage: Or(
            IsNull(),
            Not(In([...LINKEDIN_UNSTARTED_ACTION_ERRORS])),
          ),
        },
      ],
      withDeleted: true,
    });
  }

  private async getPersistedActionNeighbors({
    linkedinActionRepository,
    ownerWorkspaceMemberId,
    candidate,
    excludedActionId,
  }: {
    linkedinActionRepository: WorkspaceRepository<LinkedinActionWorkspaceEntity>;
    ownerWorkspaceMemberId: string;
    candidate: Date;
    excludedActionId?: string;
  }): Promise<{
    previousActionTimestamp: number;
    nextActionTimestamp: number;
  }> {
    const [previousAction, nextAction] = await Promise.all([
      linkedinActionRepository.findOne({
        where: {
          ...(isDefined(excludedActionId) ? { id: Not(excludedActionId) } : {}),
          ownerWorkspaceMemberId,
          status: In(LINKEDIN_PACING_STATUSES),
          scheduledAt: LessThan(candidate),
        },
        order: { scheduledAt: 'DESC' },
        select: ['scheduledAt'],
        withDeleted: true,
      }),
      linkedinActionRepository.findOne({
        where: {
          ...(isDefined(excludedActionId) ? { id: Not(excludedActionId) } : {}),
          ownerWorkspaceMemberId,
          status: In(LINKEDIN_PACING_STATUSES),
          scheduledAt: MoreThanOrEqual(candidate),
        },
        order: { scheduledAt: 'ASC' },
        select: ['scheduledAt'],
        withDeleted: true,
      }),
    ]);

    const candidateTimestamp = candidate.getTime();
    const previousActionTimestamp =
      previousAction?.scheduledAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const nextActionTimestamp =
      nextAction?.scheduledAt?.getTime() ?? Number.POSITIVE_INFINITY;

    return {
      previousActionTimestamp:
        previousActionTimestamp < candidateTimestamp
          ? previousActionTimestamp
          : Number.NEGATIVE_INFINITY,
      nextActionTimestamp:
        nextActionTimestamp >= candidateTimestamp
          ? nextActionTimestamp
          : Number.POSITIVE_INFINITY,
    };
  }

  private getNextUtcDayWindowOpen(
    candidate: Date,
    settings: SequenceSettings,
  ): Date {
    const nextUtcDayStart = new Date(
      this.getUtcDayStart(candidate).getTime() + MILLISECONDS_PER_DAY,
    );

    return nextWindowOpen(nextUtcDayStart, settings);
  }

  private getUtcDayStart(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private assertActiveTransaction(
    transactionManager: WorkspaceEntityManager,
  ): void {
    if (transactionManager.queryRunner?.isTransactionActive !== true) {
      throw new Error(
        'LinkedIn slots must be reserved inside the action insert transaction',
      );
    }
  }

  private getLastActionAtKey(senderKey: string): string {
    return `${SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX}:${senderKey}`;
  }

  private getPatternIndexKey(senderKey: string): string {
    return `${SEQUENCE_LINKEDIN_PATTERN_INDEX_CACHE_KEY_PREFIX}:${senderKey}`;
  }

  private getLockKey(senderKey: string): string {
    return `${SEQUENCE_LINKEDIN_ACTION_LOCK_KEY_PREFIX}:${senderKey}`;
  }
}
