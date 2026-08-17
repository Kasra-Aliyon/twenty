import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { type Repository } from 'typeorm';

import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import {
  SEQUENCE_LAST_SEND_AT_CACHE_KEY_PREFIX,
  SEQUENCE_LAST_SEND_AT_CACHE_TTL,
  SEQUENCE_MAILBOX_SEND_LOCK_KEY_PREFIX,
  SEQUENCE_MAILBOX_SEND_LOCK_TTL,
} from 'src/modules/sequence/sequence.constants';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

@Injectable()
export class SequenceMailboxThrottleService {
  constructor(
    @InjectCacheStorage(CacheStorageNamespace.ModuleMessaging)
    private readonly cacheStorageService: CacheStorageService,
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
  ) {}

  async acquireSendLock({
    workspaceId,
    mailboxId,
  }: {
    workspaceId: string;
    mailboxId: string;
  }): Promise<boolean> {
    return this.cacheStorageService.acquireLock(
      this.getSendLockKey(workspaceId, mailboxId),
      SEQUENCE_MAILBOX_SEND_LOCK_TTL,
    );
  }

  async releaseSendLock({
    workspaceId,
    mailboxId,
  }: {
    workspaceId: string;
    mailboxId: string;
  }): Promise<void> {
    await this.cacheStorageService.releaseLock(
      this.getSendLockKey(workspaceId, mailboxId),
    );
  }

  async getLastSendAt({
    workspaceId,
    mailboxId,
    enrollmentRepository,
  }: {
    workspaceId: string;
    mailboxId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
  }): Promise<Date | null> {
    const cachedValue = await this.cacheStorageService.get<string>(
      this.getLastSendAtCacheKey(workspaceId, mailboxId),
    );

    if (isDefined(cachedValue)) {
      const cachedDate = new Date(cachedValue);

      if (!Number.isNaN(cachedDate.getTime())) {
        return cachedDate;
      }
    }

    const enrollments = await enrollmentRepository.find({
      where: { senderConnectedAccountId: mailboxId },
      select: { sentEmailsByStepId: true },
    });
    const mostRecentTimestamp = enrollments.reduce(
      (latestTimestamp, enrollment) => {
        const enrollmentLatestTimestamp = Object.values(
          enrollment.sentEmailsByStepId ?? {},
        ).reduce((latestSentTimestamp, sentEmail) => {
          const sentTimestamp = Date.parse(sentEmail.sentAt);

          return Number.isNaN(sentTimestamp)
            ? latestSentTimestamp
            : Math.max(latestSentTimestamp, sentTimestamp);
        }, 0);

        return Math.max(latestTimestamp, enrollmentLatestTimestamp);
      },
      0,
    );

    if (mostRecentTimestamp === 0) {
      return null;
    }

    const mostRecentDate = new Date(mostRecentTimestamp);

    await this.setLastSendAt({
      workspaceId,
      mailboxId,
      date: mostRecentDate,
    });

    return mostRecentDate;
  }

  async setLastSendAt({
    workspaceId,
    mailboxId,
    date,
  }: {
    workspaceId: string;
    mailboxId: string;
    date: Date;
  }): Promise<void> {
    const key = this.getLastSendAtCacheKey(workspaceId, mailboxId);
    const existingValue = await this.cacheStorageService.get<string>(key);
    const existingTimestamp = isDefined(existingValue)
      ? Date.parse(existingValue)
      : 0;

    if (
      !Number.isNaN(existingTimestamp) &&
      existingTimestamp > date.getTime()
    ) {
      return;
    }

    await this.cacheStorageService.set(
      key,
      date.toISOString(),
      SEQUENCE_LAST_SEND_AT_CACHE_TTL,
    );
  }

  async reserveUtcDailySend({
    workspaceId,
    mailboxId,
    now,
  }: {
    workspaceId: string;
    mailboxId: string;
    now: Date;
  }): Promise<{ usageDate: string } | null> {
    const usageDate = now.toISOString().slice(0, 10);
    const reservedRows = (await this.connectedAccountRepository.query(
      `UPDATE "core"."connectedAccount"
       SET "sequenceDailyEmailUsageDate" = $3::date,
           "sequenceDailyEmailUsageCount" = CASE
             WHEN "sequenceDailyEmailUsageDate" = $3::date
               THEN "sequenceDailyEmailUsageCount" + 1
             ELSE 1
           END,
           "updatedAt" = NOW()
       WHERE "id" = $1
         AND "workspaceId" = $2
         AND (
           "sequenceDailyEmailLimitEnabled" = FALSE
           OR CASE
             WHEN "sequenceDailyEmailUsageDate" = $3::date
               THEN "sequenceDailyEmailUsageCount"
             ELSE 0
           END < "sequenceDailyEmailLimit"
         )
       RETURNING "id"`,
      [mailboxId, workspaceId, usageDate],
    )) as { id: string }[];

    return reservedRows.length === 1 ? { usageDate } : null;
  }

  async releaseUtcDailySendReservation({
    workspaceId,
    mailboxId,
    usageDate,
  }: {
    workspaceId: string;
    mailboxId: string;
    usageDate: string;
  }): Promise<void> {
    await this.connectedAccountRepository.query(
      `UPDATE "core"."connectedAccount"
       SET "sequenceDailyEmailUsageCount" = "sequenceDailyEmailUsageCount" - 1,
           "updatedAt" = NOW()
       WHERE "id" = $1
         AND "workspaceId" = $2
         AND "sequenceDailyEmailUsageDate" = $3::date
         AND "sequenceDailyEmailUsageCount" > 0`,
      [mailboxId, workspaceId, usageDate],
    );
  }

  private getLastSendAtCacheKey(
    workspaceId: string,
    mailboxId: string,
  ): string {
    return `${SEQUENCE_LAST_SEND_AT_CACHE_KEY_PREFIX}:${workspaceId}:${mailboxId}`;
  }

  private getSendLockKey(workspaceId: string, mailboxId: string): string {
    return `${SEQUENCE_MAILBOX_SEND_LOCK_KEY_PREFIX}:${workspaceId}:${mailboxId}`;
  }
}
