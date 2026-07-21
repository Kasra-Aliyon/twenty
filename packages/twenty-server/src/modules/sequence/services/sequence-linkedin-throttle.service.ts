import { Injectable } from '@nestjs/common';

import { type SequenceSettings } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import {
  SEQUENCE_LINKEDIN_ACTION_LOCK_KEY_PREFIX,
  SEQUENCE_LINKEDIN_ACTION_LOCK_TTL,
  SEQUENCE_LINKEDIN_DAILY_COUNT_CACHE_KEY_PREFIX,
  SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX,
  SEQUENCE_LINKEDIN_PATTERN_INDEX_CACHE_KEY_PREFIX,
  SEQUENCE_LINKEDIN_THROTTLE_CACHE_TTL,
} from 'src/modules/sequence/sequence.constants';
import {
  isWithinSendingWindow,
  nextWindowOpen,
  startOfDayInTimezone,
} from 'src/modules/sequence/utils/sequence-window.util';

const LINKEDIN_THROTTLE_LOCK_RETRY_COUNT = 10;
const LINKEDIN_THROTTLE_LOCK_RETRY_DELAY_MILLISECONDS = 10;

@Injectable()
export class SequenceLinkedinThrottleService {
  constructor(
    @InjectCacheStorage(CacheStorageNamespace.ModuleMessaging)
    private readonly cacheStorageService: CacheStorageService,
  ) {}

  async reserveSlot({
    workspaceId,
    sequenceId,
    settings,
    now,
  }: {
    workspaceId: string;
    sequenceId: string;
    settings: SequenceSettings;
    now: Date;
  }): Promise<Date> {
    const lockKey = this.getLockKey(workspaceId, sequenceId);
    const lockAcquired = await this.acquireLock(lockKey);

    if (!lockAcquired) {
      throw new Error('Could not acquire the LinkedIn sequence throttle lock');
    }

    try {
      const [lastActionAtValue, patternIndexValue] = await Promise.all([
        this.cacheStorageService.get<string>(
          this.getLastActionAtKey(workspaceId, sequenceId),
        ),
        this.cacheStorageService.get<number>(
          this.getPatternIndexKey(workspaceId, sequenceId),
        ),
      ]);
      const lastActionAt = isDefined(lastActionAtValue)
        ? new Date(lastActionAtValue)
        : now;
      const safeLastActionAt = Number.isNaN(lastActionAt.getTime())
        ? now
        : lastActionAt;
      const patternIndex =
        typeof patternIndexValue === 'number' &&
        Number.isInteger(patternIndexValue) &&
        patternIndexValue >= 0
          ? patternIndexValue
          : 0;
      const delayMinutes =
        settings.linkedinDelayPatternMinutes[
          patternIndex % settings.linkedinDelayPatternMinutes.length
        ];
      const delayMilliseconds = delayMinutes * 60 * 1000;
      let candidate = new Date(
        Math.max(now.getTime(), safeLastActionAt.getTime() + delayMilliseconds),
      );

      if (!isWithinSendingWindow(candidate, settings)) {
        candidate = nextWindowOpen(candidate, settings);
      }

      let scheduledDayCount = await this.getScheduledDayCount({
        workspaceId,
        sequenceId,
        candidate,
        settings,
      });

      for (
        let dayRollCount = 0;
        scheduledDayCount >= settings.linkedinDailyActions;
        dayRollCount += 1
      ) {
        if (dayRollCount > 14) {
          throw new Error('Could not find an available LinkedIn action day');
        }

        candidate = this.getNextDayWindowOpen(candidate, settings);
        scheduledDayCount = await this.getScheduledDayCount({
          workspaceId,
          sequenceId,
          candidate,
          settings,
        });
      }

      await Promise.all([
        this.cacheStorageService.set(
          this.getLastActionAtKey(workspaceId, sequenceId),
          candidate.toISOString(),
          SEQUENCE_LINKEDIN_THROTTLE_CACHE_TTL,
        ),
        this.cacheStorageService.set(
          this.getPatternIndexKey(workspaceId, sequenceId),
          patternIndex + 1,
          SEQUENCE_LINKEDIN_THROTTLE_CACHE_TTL,
        ),
        this.cacheStorageService.set(
          this.getDailyCountKey(
            workspaceId,
            sequenceId,
            candidate,
            settings.timezone,
          ),
          scheduledDayCount + 1,
          SEQUENCE_LINKEDIN_THROTTLE_CACHE_TTL,
        ),
      ]);

      return candidate;
    } finally {
      await this.cacheStorageService.releaseLock(lockKey);
    }
  }

  private async acquireLock(lockKey: string): Promise<boolean> {
    for (
      let attempt = 0;
      attempt < LINKEDIN_THROTTLE_LOCK_RETRY_COUNT;
      attempt += 1
    ) {
      if (
        await this.cacheStorageService.acquireLock(
          lockKey,
          SEQUENCE_LINKEDIN_ACTION_LOCK_TTL,
        )
      ) {
        return true;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, LINKEDIN_THROTTLE_LOCK_RETRY_DELAY_MILLISECONDS),
      );
    }

    return false;
  }

  private async getScheduledDayCount({
    workspaceId,
    sequenceId,
    candidate,
    settings,
  }: {
    workspaceId: string;
    sequenceId: string;
    candidate: Date;
    settings: SequenceSettings;
  }): Promise<number> {
    const cachedCount = await this.cacheStorageService.get<number>(
      this.getDailyCountKey(
        workspaceId,
        sequenceId,
        candidate,
        settings.timezone,
      ),
    );

    return typeof cachedCount === 'number' &&
      Number.isInteger(cachedCount) &&
      cachedCount >= 0
      ? cachedCount
      : 0;
  }

  private getNextDayWindowOpen(
    candidate: Date,
    settings: SequenceSettings,
  ): Date {
    const currentDayStart = startOfDayInTimezone(candidate, settings.timezone);
    let nextDayProbe = new Date(
      currentDayStart.getTime() + 24 * 60 * 60 * 1000,
    );

    while (
      startOfDayInTimezone(nextDayProbe, settings.timezone).getTime() ===
      currentDayStart.getTime()
    ) {
      nextDayProbe = new Date(nextDayProbe.getTime() + 60 * 60 * 1000);
    }

    return nextWindowOpen(
      startOfDayInTimezone(nextDayProbe, settings.timezone),
      settings,
    );
  }

  private getDailyCountKey(
    workspaceId: string,
    sequenceId: string,
    candidate: Date,
    timeZone: string,
  ): string {
    const dayKey = startOfDayInTimezone(candidate, timeZone).toISOString();

    return `${SEQUENCE_LINKEDIN_DAILY_COUNT_CACHE_KEY_PREFIX}:${workspaceId}:${sequenceId}:${dayKey}`;
  }

  private getLastActionAtKey(workspaceId: string, sequenceId: string): string {
    return `${SEQUENCE_LINKEDIN_LAST_ACTION_AT_CACHE_KEY_PREFIX}:${workspaceId}:${sequenceId}`;
  }

  private getPatternIndexKey(workspaceId: string, sequenceId: string): string {
    return `${SEQUENCE_LINKEDIN_PATTERN_INDEX_CACHE_KEY_PREFIX}:${workspaceId}:${sequenceId}`;
  }

  private getLockKey(workspaceId: string, sequenceId: string): string {
    return `${SEQUENCE_LINKEDIN_ACTION_LOCK_KEY_PREFIX}:${workspaceId}:${sequenceId}`;
  }
}
